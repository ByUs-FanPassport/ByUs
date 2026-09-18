import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../../../../../server/config/env";
import { createPublishedContentRepositoryFromEnvironment } from "../../../../../server/content/published-content-repository";
import { createChzzkLiveRepository } from "../../../../../server/chzzk/live-repository";
import { syncChzzkLive } from "../../../../../server/chzzk/live-sync";
import { createGetChzzkLiveSyncHandler } from "../../../../../server/chzzk/live-sync-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return createGetChzzkLiveSyncHandler({
    secret: process.env.CRON_SECRET, enabled: process.env.CHZZK_LIVE_ENABLED === "true",
    run: async () => {
      const env = loadServerEnv();
      if (!env.CHZZK_CLIENT_ID || !env.CHZZK_CLIENT_SECRET) throw new Error("CHZZK credentials unavailable");
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      return syncChzzkLive({ celebrities: await createPublishedContentRepositoryFromEnvironment().list("ko"), repository: createChzzkLiveRepository(db), clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET });
    },
  })(request);
}
