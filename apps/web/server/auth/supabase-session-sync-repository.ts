import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { CanonicalPrivyIdentity, CanonicalWallet } from "../../features/auth/domain/identity";
import {
  preferredLocaleSchema,
  type PreferredLocale,
} from "../../features/profile/domain/preferred-locale";
import { fanProfileSchema } from "../../features/profile/domain/profile";
import {
  reportRecoveryFailure,
  withOperationDeadline,
} from "../../features/reliability/client/request-deadline";
import type { SessionSyncRepository } from "./session-sync";
import { canDeferNotificationSync } from "./notification-sync-recovery";

const SESSION_STAGE_TIMEOUT_MS = 20_000;
const OPTIONAL_SYNC_TIMEOUT_MS = 2_000;

type SessionSyncStage =
  | "session.identity"
  | "session.locale"
  | "session.notification"
  | "session.notification_fallback"
  | "session.profile";

export type SessionSyncRecoveryOptions = {
  canDeferNotificationSync?: (
    ownerId: string,
    identity: CanonicalPrivyIdentity,
  ) => Promise<boolean>;
};

function throwStageError(stage: SessionSyncStage, message: string): never {
  const error = new Error(message);
  reportRecoveryFailure(stage, error);
  throw error;
}

interface SessionSyncRpcClient {
  rpc(name: string, parameters: Record<string, string | number | boolean>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export class SupabaseSessionSyncRepository implements SessionSyncRepository {
  constructor(
    private readonly client: SessionSyncRpcClient,
    private readonly recovery: SessionSyncRecoveryOptions = {},
  ) {}

  private async rpc(
    name: string,
    parameters: Record<string, string | number | boolean>,
    timeoutMs = SESSION_STAGE_TIMEOUT_MS,
  ) {
    return withOperationDeadline(
      Promise.resolve(this.client.rpc(name, parameters)),
      timeoutMs,
    );
  }

  private async failClosed<T>(stage: SessionSyncStage, operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      reportRecoveryFailure(stage, error);
      throw error;
    }
  }

  async sync(
    identity: CanonicalPrivyIdentity,
    wallet: CanonicalWallet,
    preferredLocale: PreferredLocale,
  ) {
    const { data, error } = await this.failClosed("session.identity", this.rpc("sync_privy_identity", {
      p_privy_user_id: identity.privyUserId,
      p_verified_email: identity.verifiedEmail,
      p_chain_id: wallet.chainId,
      p_wallet_address: wallet.address,
    }));
    if (error) throwStageError("session.identity", "Identity synchronization failed");
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== "object" || !("app_user_id" in row) || typeof row.app_user_id !== "string") {
      throwStageError("session.identity", "Identity synchronization returned an invalid owner");
    }
    try {
      const localeInitialization = await this.rpc("initialize_owned_preferred_locale", {
        p_app_user_id: row.app_user_id,
        p_locale: preferredLocale,
      }, OPTIONAL_SYNC_TIMEOUT_MS);
      if (localeInitialization.error) throw new Error("Preferred locale initialization failed");
      if (!preferredLocaleSchema.safeParse(localeInitialization.data).success) {
        throw new Error("Preferred locale initialization returned invalid data");
      }
    } catch (localeError) {
      reportRecoveryFailure("session.locale", localeError);
    }
    try {
      const notificationProjection = await this.failClosed("session.notification", this.rpc("sync_owned_google_notification_channel", {
        p_app_user_id: row.app_user_id,
        p_privy_user_id: identity.privyUserId,
        p_verified_email: identity.verifiedEmail,
        p_google_connected: identity.googleLinked === true,
      }, OPTIONAL_SYNC_TIMEOUT_MS));
      if (notificationProjection.error) throwStageError("session.notification", "Notification identity projection failed");
    } catch (notificationError) {
      let safeToDefer = false;
      if (this.recovery.canDeferNotificationSync) {
        try {
          safeToDefer = await withOperationDeadline(
            this.recovery.canDeferNotificationSync(row.app_user_id, identity),
            OPTIONAL_SYNC_TIMEOUT_MS,
          );
        } catch (fallbackError) {
          reportRecoveryFailure("session.notification_fallback", fallbackError);
        }
      }
      if (!safeToDefer) throw notificationError;
    }
    const profileResult = await this.failClosed("session.profile", this.rpc("get_owned_user_profile", { p_app_user_id: row.app_user_id }));
    if (profileResult.error) throwStageError("session.profile", "Profile state lookup failed");
    const profile = fanProfileSchema.safeParse(profileResult.data);
    if (!profile.success) throwStageError("session.profile", "Profile state lookup returned invalid data");
    return profile.data;
  }
}

export function createSupabaseSessionSyncRepository(config: { url: string; serviceRoleKey: string }): SessionSyncRepository {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return new SupabaseSessionSyncRepository(client as unknown as SessionSyncRpcClient, {
    canDeferNotificationSync: (ownerId, identity) => canDeferNotificationSync(client, ownerId, identity),
  });
}
