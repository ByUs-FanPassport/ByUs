import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  authenticatePrivyAccessToken,
  type PrivyAccessVerifier,
} from "../auth/authenticate-privy";
import type { IdentityRepository } from "../repositories/identity-repository";

export type FanAuthRepository = Pick<IdentityRepository, "findUserByPrivyId">;

export interface AuthorizedFan {
  appUserId: string;
}

export class FanAuthUnavailableError extends Error {
  readonly code = "FAN_AUTH_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("Fan authentication is temporarily unavailable");
    this.name = "FanAuthUnavailableError";
  }
}

function requireBearerToken(authorization: string | null | undefined): string {
  const match = authorization
    ? /^Bearer[ \t]+([^\s]+)$/i.exec(authorization.trim())
    : null;
  if (!match) {
    throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
  }
  return match[1];
}

async function authenticate(
  accessToken: string,
  verifier: PrivyAccessVerifier,
): ReturnType<typeof authenticatePrivyAccessToken> {
  try {
    return await authenticatePrivyAccessToken(accessToken, verifier);
  } catch {
    throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
  }
}

export async function authorizeFanRequest(input: {
  authorization?: string | null;
  verifier: PrivyAccessVerifier;
  repository: FanAuthRepository;
}): Promise<AuthorizedFan> {
  const identity = await authenticate(requireBearerToken(input.authorization), input.verifier);
  let user: Awaited<ReturnType<FanAuthRepository["findUserByPrivyId"]>>;
  try {
    user = await input.repository.findUserByPrivyId(identity.privyUserId);
  } catch {
    throw new FanAuthUnavailableError();
  }

  if (!user || user.status !== "active") {
    throw new AuthError("AUTHENTICATION_REQUIRED", 403, "Fan access is unavailable");
  }

  return { appUserId: user.id };
}
