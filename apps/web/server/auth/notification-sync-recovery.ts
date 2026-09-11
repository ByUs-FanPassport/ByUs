import "server-only";
import type { CanonicalPrivyIdentity } from "../../features/auth/domain/identity";

type RecoveryClient = {
  rpc(name: string, parameters: Record<string, string | boolean>): PromiseLike<{ data: unknown; error: unknown }>;
};

/** The RPC returns only a safety decision; private recipient tables remain revoked. */
export async function canDeferNotificationSync(
  client: RecoveryClient,
  ownerId: string,
  identity: CanonicalPrivyIdentity,
): Promise<boolean> {
  const result = await client.rpc("can_defer_owned_notification_sync", {
    p_app_user_id: ownerId,
    p_privy_user_id: identity.privyUserId,
    p_verified_email: identity.verifiedEmail,
    p_google_connected: identity.googleLinked === true,
  });
  return !result.error && result.data === true;
}
