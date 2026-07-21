export type AuthErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_PRIVY_IDENTITY"
  | "VERIFIED_EMAIL_REQUIRED"
  | "INVALID_EMAIL"
  | "INVALID_WALLET"
  | "WALLET_ALREADY_LINKED"
  | "WALLET_RELINK_REQUIRES_REVIEW"
  | "ADMIN_NOT_ALLOWLISTED"
  | "ADMIN_DISABLED"
  | "ADMIN_EMAIL_MISMATCH";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: 401 | 403 | 409 | 422;

  constructor(code: AuthErrorCode, status: 401 | 403 | 409 | 422, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}
