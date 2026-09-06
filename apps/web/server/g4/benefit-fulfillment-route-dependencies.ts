import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createSupabaseBenefitFulfillmentRepository } from "./benefit-fulfillment-repository";
export function createBenefitFulfillmentRouteDependencies(){const e=loadServerEnv(),db=createClient(e.SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),fan=createSupabaseFanAuthRepository({url:e.SUPABASE_URL,serviceRoleKey:e.SUPABASE_SERVICE_ROLE_KEY},db),verifier=createPrivyNodeAccessVerifier({appId:e.PRIVY_APP_ID,appSecret:e.PRIVY_APP_SECRET,appEnvironment:e.PRIVY_APP_ENVIRONMENT,testAccountLoginEnabled:e.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: e.PRIVY_APPLE_LOGIN_ENABLED});return{repository:createSupabaseBenefitFulfillmentRepository({url:e.SUPABASE_URL,serviceRoleKey:e.SUPABASE_SERVICE_ROLE_KEY},db),authorize:(authorization:string|null)=>authorizeFanRequest({authorization,verifier,repository:fan})};}
