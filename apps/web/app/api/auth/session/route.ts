import { z } from "zod";
import { AuthError } from "../../../../features/auth/domain/auth-errors";
import { preferredLocaleSchema } from "../../../../features/profile/domain/preferred-locale";
import { createPrivyNodeSessionResolver } from "../../../../server/auth/privy-node-verifier";
import { syncAuthenticatedSession } from "../../../../server/auth/session-sync";
import { createSupabaseSessionSyncRepository } from "../../../../server/auth/supabase-session-sync-repository";
import { loadServerEnv } from "../../../../server/config/env";
import { AppleReauthenticationRequiredError } from "../../../../server/auth/apple-notifications/apple-lifecycle";
import {
  createSessionTimingDiagnostics,
  normalizedSessionError,
} from "../../../../server/auth/session-diagnostics";
import {
  reportRecoveryFailure,
  withOperationDeadline,
} from "../../../../features/reliability/client/request-deadline";

export const dynamic = "force-dynamic";
const sessionRequestSchema = z.object({ locale: preferredLocaleSchema }).strict();
const SESSION_REQUEST_TIMEOUT_MS = 30_000;

export async function POST(request: Request): Promise<Response> {
  const env = loadServerEnv();
  const diagnostics = createSessionTimingDiagnostics({ timeoutMs: SESSION_REQUEST_TIMEOUT_MS });
  try {
    const rawBody = await request.text();
    const requestedLocale = rawBody
      ? sessionRequestSchema.parse(JSON.parse(rawBody)).locale
      : "ko";
    const profile = await withOperationDeadline(syncAuthenticatedSession({
      authorization: request.headers.get("authorization") ?? "",
      chainId: env.GIWA_CHAIN_ID,
      preferredLocale: requestedLocale,
      resolver: diagnostics.wrapResolver(createPrivyNodeSessionResolver({
        appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET,
        appEnvironment: env.PRIVY_APP_ENVIRONMENT,
        testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
      })),
      repository: diagnostics.wrapRepository(createSupabaseSessionSyncRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })),
    }), SESSION_REQUEST_TIMEOUT_MS);
    diagnostics.success();
    return Response.json({ profile }, { status: 200, headers: { "cache-control": "no-store", vary: "Authorization" } });
  } catch (error) {
    diagnostics.failure(error);
    try {
      reportRecoveryFailure("session.request", error);
    } catch {
      // Logging must not replace the authentication response.
    }
    const logError = normalizedSessionError(error, SESSION_REQUEST_TIMEOUT_MS);
    try {
      console.error("[auth/session] synchronization failed", {
        name: logError.name,
        code: logError.code,
      });
    } catch {
      // Logging must not replace the authentication response.
    }
    const invalidRequest =
      error instanceof SyntaxError ||
      (error instanceof Error && error.name === "ZodError");
    const status = invalidRequest ? 400 : error instanceof AuthError ? error.status : 503;
    const code = invalidRequest ? "INVALID_SESSION_REQUEST" : error instanceof AuthError ? error.code : "SESSION_SYNC_FAILED";
    return Response.json({ error: {
      code,
      ...(error instanceof AppleReauthenticationRequiredError ? { providers: error.providers } : {}),
    } }, { status, headers: { "cache-control": "no-store" } });
  }
}
