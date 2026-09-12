import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../../../../../server/config/env";
import { loadInstagramConfig } from "../../../../../server/instagram/config";
import { tokenVault } from "../../../../../server/instagram/crypto";
import { createInstagramLiveRepository } from "../../../../../server/instagram/live-repository";
import { syncInstagramLive } from "../../../../../server/instagram/live-sync";
import { createGetInstagramLiveSyncHandler } from "../../../../../server/instagram/live-sync-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return createGetInstagramLiveSyncHandler({
    secret: process.env.CRON_SECRET,
    enabled: process.env.INSTAGRAM_INTEGRATION_ENABLED === "true",
    run: async () => {
      const config = loadInstagramConfig();
      const env = loadServerEnv();
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      return syncInstagramLive({ repository: createInstagramLiveRepository(db), vault: tokenVault(config.encryptionKey), graphVersion: config.graphVersion });
    },
  })(request);
}
