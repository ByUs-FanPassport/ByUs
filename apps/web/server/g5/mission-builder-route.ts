import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";

const media=z.object({type:z.enum(["image","video"]),url:z.string().url()}).nullable().optional();
const option=z.object({position:z.number().int().positive(),label:z.object({ko:z.string().min(1),en:z.string().min(1)}),media});
const question=z.object({position:z.number().int().positive(),text:z.object({ko:z.string().min(1),en:z.string().min(1)}),media,correctPosition:z.number().int().positive().nullable(),options:z.array(option).min(2)});
const missionSettings=z.object({type:z.enum(["quiz","survey","vote"]),attendanceRequirement:z.enum(["required","not_required"]),title:z.object({ko:z.string().min(1),en:z.string().min(1)}),description:z.object({ko:z.string(),en:z.string()}),visibleFrom:z.iso.datetime({offset:true}),visibleUntil:z.iso.datetime({offset:true}),questions:z.array(question).min(1)});
const validWindow=(value:{visibleFrom:string;visibleUntil:string})=>Date.parse(value.visibleFrom)<Date.parse(value.visibleUntil);
const createCommand=missionSettings.extend({command:z.literal("create")}).refine(validWindow,{message:"visibility window must increase"});
const updateCommand=missionSettings.extend({command:z.literal("update"),missionId:z.string().uuid()}).refine(validWindow,{message:"visibility window must increase"});
const command=z.union([createCommand,updateCommand,z.object({command:z.literal("publish"),missionId:z.string().uuid()})]);
const hasInvalidMissionGraph=(value:z.infer<typeof createCommand>|z.infer<typeof updateCommand>)=>value.questions.some((q,index)=>q.position!==index+1||q.options.some((o,i)=>o.position!==i+1)||(value.type==="quiz")!==(q.correctPosition!==null));

export type MissionBuilderRepository={write(input:{actor:AdminSession;liveEventId:string;command:z.infer<typeof command>;correlationId:string}):Promise<unknown>;statistics(input:{actor:AdminSession;liveEventId:string}):Promise<unknown>;};
type Dependencies={authorize(input:{authorization:string;correlationId:string}):Promise<AdminSession>;repository:MissionBuilderRepository};

export function createSupabaseMissionBuilderRepository(input:{url:string;serviceRoleKey:string}):MissionBuilderRepository{
  const db=createClient(input.url,input.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  return {
    async write(value){const {data,error}=await db.rpc("admin_write_live_mission",{p_actor_app_user_id:value.actor.appUserId,p_actor_allowlist_id:value.actor.allowlistId,p_live_event_id:value.liveEventId,p_command:value.command.command,p_payload:value.command,p_correlation_id:value.correlationId});if(error)throw error;return data;},
    async statistics(value){const {data,error}=await db.rpc("get_admin_live_mission_statistics",{p_actor_app_user_id:value.actor.appUserId,p_actor_allowlist_id:value.actor.allowlistId,p_live_event_id:value.liveEventId});if(error)throw error;return data;},
  };
}
const json=(body:unknown,status:number)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",vary:"Authorization"}});
export const createGetMissionBuilderHandler=(d:Dependencies)=>async(request:Request,input:{liveEventId:string})=>{
  const correlationId=request.headers.get("x-correlation-id")??crypto.randomUUID();
  try{const actor=await d.authorize({authorization:request.headers.get("authorization")??"",correlationId});return json({missions:await d.repository.statistics({actor,liveEventId:input.liveEventId})},200);}catch(error){if(error instanceof AuthError)return json({error:{code:"FORBIDDEN"}},error.status);return json({error:{code:"MISSION_STATISTICS_UNAVAILABLE"}},503);}
};
export const createPostMissionBuilderHandler=(d:Dependencies)=>async(request:Request,input:{liveEventId:string})=>{
  const correlationId=request.headers.get("x-correlation-id")??crypto.randomUUID();
  try{
    const actor=await d.authorize({authorization:request.headers.get("authorization")??"",correlationId});
    if(actor.role==="viewer")return json({error:{code:"FORBIDDEN"}},403);
    const parsed=command.parse(await request.json());
    if(parsed.command!=="publish"&&hasInvalidMissionGraph(parsed))return json({error:{code:"INVALID_MISSION"}},422);
    const data=await d.repository.write({actor,liveEventId:input.liveEventId,command:parsed,correlationId});
    return json(data,parsed.command==="create"?201:200);
  }catch(error){if(error instanceof AuthError)return json({error:{code:"FORBIDDEN"}},error.status);if(error instanceof z.ZodError)return json({error:{code:"INVALID_MISSION"}},422);return json({error:{code:"MISSION_BUILDER_UNAVAILABLE"}},503);}
};
