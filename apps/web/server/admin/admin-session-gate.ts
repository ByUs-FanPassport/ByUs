import "server-only";

import { authorizeAdmin, type AdminRole } from "../../features/auth/domain/admin-authorization";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { normalizeEmail } from "../../features/auth/domain/identity";
import { authenticatePrivyAccessToken, type PrivyAccessVerifier } from "../auth/authenticate-privy";
import type { AppUser, IdentityRepository } from "../repositories/identity-repository";

export interface AdminAuthorizationAudit {
  actorAppUserId: string;
  actorAdminAllowlistId: string;
  correlationId: string;
  action: "admin.session.authorized";
  summary: { outcome: "authorized"; role: AdminRole };
}

export interface AdminSessionRepository
  extends Pick<IdentityRepository, "findUserByPrivyId" | "findActiveAdminByEmail"> {
  appendAuthorizationAudit(event: AdminAuthorizationAudit): Promise<void>;
}

export interface AdminSession {
  email: string;
  role: AdminRole;
}

function bearerToken(authorization: string): string {
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization.trim());
  if (!match) {
    throw new AuthError("AUTHENTICATION_REQUIRED", 401, "A bearer token is required");
  }
  return match[1];
}

function requireActiveMatchingUser(user: AppUser | null, verifiedEmail: string): AppUser {
  if (!user || user.status !== "active") {
    throw new AuthError("ADMIN_DISABLED", 403, "The application user is not active");
  }

  try {
    if (normalizeEmail(user.verifiedEmail) !== verifiedEmail) {
      throw new AuthError("ADMIN_EMAIL_MISMATCH", 403, "The verified email is not current");
    }
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) throw error;
    throw new AuthError("ADMIN_EMAIL_MISMATCH", 403, "The verified email is not current");
  }
  return user;
}

export async function authorizeAdminSession(input: {
  authorization: string;
  correlationId: string;
  verifier: PrivyAccessVerifier;
  repository: AdminSessionRepository;
}): Promise<AdminSession> {
  const identity = await authenticatePrivyAccessToken(
    bearerToken(input.authorization),
    input.verifier,
  );
  const user = requireActiveMatchingUser(
    await input.repository.findUserByPrivyId(identity.privyUserId),
    identity.verifiedEmail,
  );
  const allowlistEntry = await input.repository.findActiveAdminByEmail(identity.verifiedEmail);
  const admin = authorizeAdmin(identity, allowlistEntry);

  // Audit data intentionally excludes access tokens, Privy IDs, and email addresses.
  // Failing to persist this event fails the authorization request closed.
  await input.repository.appendAuthorizationAudit({
    actorAppUserId: user.id,
    actorAdminAllowlistId: admin.allowlistId,
    correlationId: input.correlationId,
    action: "admin.session.authorized",
    summary: { outcome: "authorized", role: admin.role },
  });

  return { email: admin.email, role: admin.role };
}
