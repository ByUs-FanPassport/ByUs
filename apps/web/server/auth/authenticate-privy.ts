import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  mapPrivyIdentity,
  type CanonicalPrivyIdentity,
  type PrivyIdentityInput,
} from "../../features/auth/domain/identity";

/**
 * Port implemented by the server-only @privy-io/node adapter. The adapter must
 * call verifyAccessToken and resolve the verified Google email for its user_id.
 */
export interface PrivyAccessVerifier {
  verify(accessToken: string): Promise<PrivyIdentityInput>;
}

export async function authenticatePrivyAccessToken(
  accessToken: string,
  verifier: PrivyAccessVerifier,
): Promise<CanonicalPrivyIdentity> {
  const token = accessToken.trim();
  if (!token) {
    throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
  }

  try {
    return mapPrivyIdentity(await verifier.verify(token));
  } catch (error) {
    if (error instanceof AuthError && error.status !== 401) {
      throw error;
    }
    throw new AuthError(
      "AUTHENTICATION_REQUIRED",
      401,
      "The Privy access token is invalid or expired",
    );
  }
}
