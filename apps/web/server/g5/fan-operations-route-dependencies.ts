import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseFanOperationsRepository } from "./fan-operations-repository";
import type { FanOperationsRouteDependencies } from "./fan-operations-route";
export function createFanOperationsRouteDependencies():FanOperationsRouteDependencies{const env=loadServerEnv();const verifier=createPrivyNodeAccessVerifier({appId:env.PRIVY_APP_ID,appSecret:env.PRIVY_APP_SECRET});const sessions=createSupabaseAdminSessionRepository({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});return{repository:createSupabaseFanOperationsRepository({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY}),authorize:({authorization,correlationId})=>authorizeAdminSession({authorization,correlationId,verifier,repository:sessions})};}
export function fanOperationsUnavailable():Response{return Response.json({error:{code:"FAN_OPERATIONS_UNAVAILABLE"}},{status:503,headers:{"cache-control":"private, no-store",vary:"Authorization"}});}
