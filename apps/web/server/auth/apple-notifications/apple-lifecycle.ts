import "server-only";

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AuthError } from "../../../features/auth/domain/auth-errors";

export const APPLE_TEAM_ID = "7RFN3TFR5K";
export const APPLE_PRIMARY_APP_ID = "kr.byus.app";
export const APPLE_SERVICE_ID = "kr.byus.web";
export const APPLE_KEY_ID = "3HVH3L9H5Z";
export const APPLE_NOTIFICATION_AUDIENCES = [APPLE_PRIMARY_APP_ID, APPLE_SERVICE_ID];

export type ReauthenticationProvider = "google" | "apple";

export interface VerifiedProviderAccount {
  subject: string;
  email: string | null;
}

/** Information obtained from a verified Privy token and its server-side user. */
export interface VerifiedPrivySession {
  privyUserId: string;
  sessionId: string;
  apple: VerifiedProviderAccount | null;
  google: VerifiedProviderAccount | null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function providerSubjectHash(provider: ReauthenticationProvider, subject: string): string {
  return sha256(provider === "apple"
    ? `apple:${APPLE_TEAM_ID}:${APPLE_PRIMARY_APP_ID}:${subject}`
    : `google:${subject}`);
}

export function privySessionHash(privyUserId: string, sessionId: string): string {
  return sha256(`privy-session:${privyUserId}:${sessionId}`);
}

function relayEmailFingerprint(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized && /^[^\s@]+@privaterelay\.appleid\.com$/.test(normalized)
    ? sha256(normalized)
    : null;
}

export interface AppleLifecycleRpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

const accessResultSchema = z.object({
  allowed: z.boolean(),
  generation: z.number().int().nonnegative(),
  appleState: z.enum(["authorized", "revoked", "deleted"]).nullable(),
  appleRecoveryAllowed: z.boolean(),
  googleRecoveryAllowed: z.boolean(),
});

export type AppleSessionAccess = z.infer<typeof accessResultSchema>;

export class AppleReauthenticationRequiredError extends AuthError {
  constructor(readonly providers: ReauthenticationProvider[]) {
    super("APPLE_REAUTHENTICATION_REQUIRED", 403, "Provider reauthentication is required");
  }
}

export class AppleLifecycleRepository {
  constructor(readonly client: AppleLifecycleRpcClient) {}

  async call<T = unknown>(name: string, parameters: Record<string, unknown>): Promise<T> {
    const result = await this.client.rpc(name, parameters);
    // Database errors may include identity data; do not return their text.
    if (result.error) throw new Error("Apple account state is temporarily unavailable");
    return result.data as T;
  }

  async check(session: VerifiedPrivySession): Promise<AppleSessionAccess> {
    if (!session.sessionId) throw new Error("Verified Privy session ID is required");
    const result = await this.call("check_apple_session_access", {
      p_identity: {
        privyUserId: session.privyUserId,
        sessionHash: privySessionHash(session.privyUserId, session.sessionId),
        appleSubjectHash: session.apple ? providerSubjectHash("apple", session.apple.subject) : null,
        appleEmailFingerprint: relayEmailFingerprint(session.apple?.email),
        googleSubjectHash: session.google ? providerSubjectHash("google", session.google.subject) : null,
      },
    });
    return accessResultSchema.parse(result);
  }

  async assertAccess(session: VerifiedPrivySession): Promise<void> {
    const result = await this.check(session);
    if (!result.allowed) {
      const providers: ReauthenticationProvider[] = [];
      if (result.googleRecoveryAllowed) providers.push("google");
      if (result.appleRecoveryAllowed) providers.push("apple");
      throw new AppleReauthenticationRequiredError(providers);
    }
  }
}

export function appleLifecycleEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  const flag = source.APPLE_LIFECYCLE_ENABLED;
  if (flag !== undefined && flag !== "true" && flag !== "false") {
    throw new Error("Invalid Apple lifecycle configuration");
  }
  return flag === "true";
}

export function createAppleLifecycleRepository(source: NodeJS.ProcessEnv = process.env): AppleLifecycleRepository {
  const url = source.SUPABASE_URL;
  const key = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Apple lifecycle database configuration is required");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return new AppleLifecycleRepository(client as unknown as AppleLifecycleRpcClient);
}

export function createConfiguredAppleLifecycleGuard(): AppleLifecycleRepository | null {
  return appleLifecycleEnabled() ? createAppleLifecycleRepository() : null;
}
