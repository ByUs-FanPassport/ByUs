import { AuthError } from "../../features/auth/domain/auth-errors";
import type { CanonicalPrivyIdentity, CanonicalWallet } from "../../features/auth/domain/identity";

export interface PrivySessionResolver {
  resolve(accessToken: string, chainId: number): Promise<{ identity: CanonicalPrivyIdentity; wallet: CanonicalWallet }>;
}

export interface SessionSyncRepository {
  sync(identity: CanonicalPrivyIdentity, wallet: CanonicalWallet): Promise<void>;
}

export async function syncAuthenticatedSession(input: {
  authorization: string;
  chainId: number;
  resolver: PrivySessionResolver;
  repository: SessionSyncRepository;
}): Promise<void> {
  const match = /^Bearer\s+(.+)$/i.exec(input.authorization.trim());
  if (!match?.[1]) throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
  const resolved = await input.resolver.resolve(match[1], input.chainId);
  await input.repository.sync(resolved.identity, resolved.wallet);
}
