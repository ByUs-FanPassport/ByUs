import { AuthError } from "../../../../features/auth/domain/auth-errors";
import { createPrivyNodeSessionResolver } from "../../../../server/auth/privy-node-verifier";
import { syncAuthenticatedSession } from "../../../../server/auth/session-sync";
import { createSupabaseSessionSyncRepository } from "../../../../server/auth/supabase-session-sync-repository";
import { loadServerEnv } from "../../../../server/config/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const env = loadServerEnv();
  try {
    await syncAuthenticatedSession({
      authorization: request.headers.get("authorization") ?? "",
      chainId: env.GIWA_CHAIN_ID,
      resolver: createPrivyNodeSessionResolver({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }),
      repository: createSupabaseSessionSyncRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[auth/session] synchronization failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown session synchronization failure",
    });
    const status = error instanceof AuthError ? error.status : 503;
    const code = error instanceof AuthError ? error.code : "SESSION_SYNC_FAILED";
    return Response.json({ error: { code } }, { status, headers: { "cache-control": "no-store" } });
  }
}
