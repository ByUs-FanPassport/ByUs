import { createPrivyNodeAccessVerifier } from "../../../../../../server/auth/privy-node-verifier";
import { authorizeAdminSession } from "../../../../../../server/admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../../../../../../server/admin/supabase-admin-session-repository";
import { loadServerEnv } from "../../../../../../server/config/env";
import { createPostMissionBuilderHandler } from "../../../../../../server/g5/mission-builder-route";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const env=loadServerEnv();const verifier=createPrivyNodeAccessVerifier({appId:env.PRIVY_APP_ID,appSecret:env.PRIVY_APP_SECRET});const repository=createSupabaseAdminSessionRepository({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});return createPostMissionBuilderHandler({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY,authorize:({authorization,correlationId})=>authorizeAdminSession({authorization,correlationId,verifier,repository})})(request,{liveEventId:(await params).id});}catch{return Response.json({error:{code:"MISSION_BUILDER_UNAVAILABLE"}},{status:503});}
}
