import "server-only";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deriveCredentialId } from "../../features/passport/domain/credential-issuance";
import { liveMissionCompletionSchema, liveMissionListSchema } from "../../features/live/domain/live-mission";

type RpcClient = Pick<SupabaseClient,"rpc">;
export class LiveMissionRepositoryError extends Error { constructor(readonly code:string){ super(code); } }
function check<T>(data:unknown,error:{message:string}|null,schema:{parse(value:unknown):T}):T {
  if(error){ const marker=error.message.match(/PHASE2_MISSION_[A-Z_]+/)?.[0] ?? "PHASE2_MISSION_UNAVAILABLE"; throw new LiveMissionRepositoryError(marker); }
  try{return schema.parse(data);}catch{throw new LiveMissionRepositoryError("PHASE2_MISSION_INTEGRITY_ERROR");}
}
export class SupabaseLiveMissionRepository {
  constructor(private db:RpcClient,private createId:()=>string=randomUUID){}
  async list(input:{appUserId:string;slug:string;locale:"ko"|"en"}){
    const {data,error}=await this.db.rpc("get_owned_live_missions",{p_app_user_id:input.appUserId,p_live_slug:input.slug,p_locale:input.locale});
    return check(data,error,liveMissionListSchema);
  }
  async submit(input:{appUserId:string;missionId:string;idempotencyKey:string;answers:unknown[]}){
    const stampId=this.createId(); const operationKey=`byus:stamp:v1:${stampId}`;
    const {data,error}=await this.db.rpc("submit_owned_live_mission",{p_app_user_id:input.appUserId,p_mission_id:input.missionId,p_idempotency_key:input.idempotencyKey,p_answers:input.answers,p_stamp_id:stampId,p_stamp_operation_key:operationKey,p_stamp_issuance_id:deriveCredentialId(operationKey)});
    return check(data,error,liveMissionCompletionSchema);
  }
}
export function createLiveMissionRepository(config:{url:string;serviceRoleKey:string}){
  return new SupabaseLiveMissionRepository(createClient(config.url,config.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}));
}

