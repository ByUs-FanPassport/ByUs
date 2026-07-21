import type {
  AdminAllowlistEntry,
  AdminRole,
} from "../../features/auth/domain/admin-authorization";
import type {
  CanonicalPrivyIdentity,
  CanonicalWallet,
  WalletOwner,
} from "../../features/auth/domain/identity";

export type AppUserStatus = "active" | "disabled";

export interface AppUser {
  id: string;
  privyUserId: string;
  verifiedEmail: string;
  status: AppUserStatus;
}

export interface AuditContext {
  actorAppUserId: string;
  correlationId: string;
}

/**
 * Server-only persistence port. Implementations must be constructed with the
 * Supabase service-role credential and must never be imported into client code.
 */
export interface IdentityRepository {
  findUserByPrivyId(privyUserId: string): Promise<AppUser | null>;
  createUser(identity: CanonicalPrivyIdentity): Promise<AppUser>;
  updateVerifiedEmail(appUserId: string, verifiedEmail: string): Promise<AppUser>;
  findWalletForUser(appUserId: string, chainId: number): Promise<CanonicalWallet | null>;
  findWalletOwner(wallet: CanonicalWallet): Promise<WalletOwner | null>;
  linkWallet(
    appUserId: string,
    context: AuditContext,
    wallet: CanonicalWallet,
  ): Promise<void>;
  findActiveAdminByEmail(normalizedEmail: string): Promise<AdminAllowlistEntry | null>;
  setUserStatus(
    appUserId: string,
    status: AppUserStatus,
    context: AuditContext,
  ): Promise<void>;
  setAdminRole(
    allowlistId: string,
    role: AdminRole,
    active: boolean,
    context: AuditContext,
  ): Promise<void>;
}
