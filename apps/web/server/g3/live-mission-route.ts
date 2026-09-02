import "server-only";
import { z } from "zod";
import { submitLiveMissionSchema } from "../../features/live/domain/live-mission";
import { LiveMissionRepositoryError, SupabaseLiveMissionRepository } from "./live-mission-repository";

type Deps={authorize(value:string|null):Promise<{appUserId:string}>;repository:SupabaseLiveMissionRepository};
const locale=z.enum(["ko","en"]); const uuid=z.string().uuid();
const json=(body:unknown,status:number)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",vary:"Authorization"}});
function mapped(error:unknown){
  if(!(error instanceof LiveMissionRepositoryError)) return json({error:{code:"MISSION_UNAVAILABLE"}},503);
  const code=error.code.replace("PHASE2_","");
  const status=code.endsWith("NOT_FOUND")?404:code.includes("REQUIRED")?403:code.includes("INVALID")?422:code.includes("ALREADY")||code.includes("CONFLICT")||code.includes("WALLET")||code.includes("NOT_VISIBLE")?409:503;
  return json({error:{code}},status);
}
export const createGetLiveMissionsHandler=(d:Deps)=>async(request:Request,input:{slug:string})=>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) return json({error:{code:"MISSION_NOT_FOUND"}},404);
  try{const owner=await d.authorize(request.headers.get("authorization")); const lang=locale.parse(new URL(request.url).searchParams.get("locale")??"ko"); return json(await d.repository.list({appUserId:owner.appUserId,slug:input.slug,locale:lang}),200);}catch(error){return mapped(error);}
};
export const createPostLiveMissionHandler=(d:Deps)=>async(request:Request,input:{missionId:string})=>{
  try{const missionId=uuid.parse(input.missionId); const body=submitLiveMissionSchema.parse(await request.json()); const owner=await d.authorize(request.headers.get("authorization")); return json(await d.repository.submit({appUserId:owner.appUserId,missionId,idempotencyKey:body.idempotencyKey,answers:body.answers}),200);}catch(error){return mapped(error);}
};
