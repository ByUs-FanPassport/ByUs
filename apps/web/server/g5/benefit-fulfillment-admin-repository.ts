import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FulfillmentStatus } from "../../features/benefit/domain/fulfillment";
export type FulfillmentAdminActor={appUserId:string;allowlistId:string};
export interface BenefitFulfillmentAdminRepository {
  read(input:{actor:FulfillmentAdminActor;correlationId:string;winnerId:string;reveal:boolean}):Promise<Record<string,unknown>>;
  transition(input:{actor:FulfillmentAdminActor;correlationId:string;winnerId:string;expectedRevision:number;toStatus:FulfillmentStatus;carrier?:string;trackingNumber?:string;operatorMemo:string}):Promise<Record<string,unknown>>;
}
type RpcClient=Pick<SupabaseClient,"rpc">;
export function createSupabaseBenefitFulfillmentAdminRepository(config:{url:string;serviceRoleKey:string},client?:RpcClient):BenefitFulfillmentAdminRepository{
 const db=client??createClient(config.url,config.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}), actor=(a:FulfillmentAdminActor)=>({p_actor_app_user_id:a.appUserId,p_actor_admin_allowlist_id:a.allowlistId});
 return {
  async read(i){const {data,error}=await db.rpc("get_admin_benefit_winner",{...actor(i.actor),p_correlation_id:i.correlationId,p_winner_id:i.winnerId,p_reveal:i.reveal});if(error)throw new Error(error.message);return data as Record<string,unknown>;},
  async transition(i){const {data,error}=await db.rpc("transition_admin_benefit_fulfillment",{...actor(i.actor),p_correlation_id:i.correlationId,p_winner_id:i.winnerId,p_expected_revision:i.expectedRevision,p_to_status:i.toStatus,p_carrier:i.carrier??null,p_tracking_number:i.trackingNumber??null,p_operator_memo:i.operatorMemo});if(error)throw new Error(error.message);return data as Record<string,unknown>;},
 };
}
