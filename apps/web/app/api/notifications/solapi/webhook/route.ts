import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "@/server/config/env";
import { createSolapiWebhookHandler } from "@/server/notification/solapi-webhook-route";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const env = loadServerEnv();
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return createSolapiWebhookHandler({ secret: env.SOLAPI_WEBHOOK_SECRET, client })(request);
  } catch { return Response.json({ error: { code: "SOLAPI_WEBHOOK_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
