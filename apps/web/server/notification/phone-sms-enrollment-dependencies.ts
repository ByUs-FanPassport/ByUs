import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { PhoneSmsEnrollmentRepository } from "./phone-sms-enrollment";
import { SolapiPhoneSmsProvider } from "./phone-sms-provider";
import type { PhoneSmsDependencies } from "./phone-sms-enrollment-route";

export function createPhoneSmsDependencies(): PhoneSmsDependencies {
  const env = loadServerEnv();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, appEnvironment: env.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED });
  const fans = createSupabaseFanAuthRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, db);
  return { enabled: env.PHONE_SMS_ENROLLMENT_MODE === "solapi", origin: new URL(env.NEXT_PUBLIC_APP_URL).origin, otpSecret: env.PHONE_SMS_OTP_SECRET ?? "",
    authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository: fans }), repository: new PhoneSmsEnrollmentRepository(db),
    provider: new SolapiPhoneSmsProvider({ apiKey: env.PHONE_SMS_SOLAPI_API_KEY ?? "", apiSecret: env.PHONE_SMS_SOLAPI_API_SECRET ?? "", sender: env.PHONE_SMS_SENDER ?? "" }) };
}
