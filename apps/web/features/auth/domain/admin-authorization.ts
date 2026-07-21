import { AuthError } from "./auth-errors";
import { normalizeEmail, type CanonicalPrivyIdentity } from "./identity";

export type AdminRole = "admin" | "operator" | "viewer";

export interface AdminAllowlistEntry {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
}

export interface AuthorizedAdmin {
  allowlistId: string;
  privyUserId: string;
  email: string;
  role: AdminRole;
}

export function authorizeAdmin(
  identity: CanonicalPrivyIdentity | null,
  allowlistEntry: AdminAllowlistEntry | null,
): AuthorizedAdmin {
  if (!identity) {
    throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
  }
  if (!allowlistEntry) {
    throw new AuthError("ADMIN_NOT_ALLOWLISTED", 403, "Admin access is not allowlisted");
  }
  if (!allowlistEntry.active) {
    throw new AuthError("ADMIN_DISABLED", 403, "Admin access is disabled");
  }

  const identityEmail = normalizeEmail(identity.verifiedEmail);
  const allowlistedEmail = normalizeEmail(allowlistEntry.email);
  if (identityEmail !== allowlistedEmail) {
    throw new AuthError(
      "ADMIN_EMAIL_MISMATCH",
      403,
      "Verified email does not match the admin allowlist",
    );
  }

  return {
    allowlistId: allowlistEntry.id,
    privyUserId: identity.privyUserId,
    email: identityEmail,
    role: allowlistEntry.role,
  };
}
