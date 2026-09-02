import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";

const media=z.object({type:z.enum(["image","video"]),url:z.string().url()}).nullable().optional();
const option=z.object({position:z.number().int().positive(),label:z.object({ko:z.string().min(1),en:z.string().min(1)}),media});
const question=z.object({position:z.number().int().positive(),text:z.object({ko:z.string().min(1),en:z.string().min(1)}),media,correctPosition:z.number().int().positive().nullable(),options:z.array(option).min(2)});
const command=z.discriminatedUnion("command",[
  z.object({command:z.literal("create"),type:z.enum(["quiz","survey","vote"]),attendanceRequirement:z.enum(["required","not_required"]),title:z.object({ko:z.string().min(1),en:z.string().min(1)}),description:z.object({ko:z.string(),en:z.string()}),questions:z.array(question).min(1)}),
  z.object({command:z.literal("publish"),missionId:z.string().uuid()}),
]);
type Dependencies={authorize(input:{authorization:string;correlationId:string}):Promise<AdminSession>;url:string;serviceRoleKey:string};
export const createPostMissionBuilderHandler=(d:Dependencies)=>async(request:Request,input:{liveEventId:string})=>{
  const correlationId=request.headers.get("x-correlation-id")??crypto.randomUUID();
  try{
    const actor=await d.authorize({authorization:request.headers.get("authorization")??"",correlationId});
    if(actor.role==="viewer") return Response.json({error:{code:"FORBIDDEN"}},{status:403});
    const parsed=command.parse(await request.json());
    if(parsed.command==="create" && parsed.questions.some((q,index)=>q.position!==index+1 || q.options.some((o,i)=>o.position!==i+1) || (parsed.type==="quiz")!==(q.correctPosition!==null))) return Response.json({error:{code:"INVALID_MISSION"}},{status:422});
    const db=createClient(d.url,d.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await db.rpc("admin_write_live_mission",{p_actor_app_user_id:actor.appUserId,p_actor_allowlist_id:actor.allowlistId,p_live_event_id:input.liveEventId,p_command:parsed.command,p_payload:parsed,p_correlation_id:correlationId});
    if(error) throw error;
    return Response.json(data,{status:parsed.command==="create"?201:200});
  }catch(error){
    if(error instanceof AuthError) return Response.json({error:{code:"FORBIDDEN"}},{status:error.status});
    if(error instanceof z.ZodError) return Response.json({error:{code:"INVALID_MISSION"}},{status:422});
    return Response.json({error:{code:"MISSION_BUILDER_UNAVAILABLE"}},{status:503});
  }
};

