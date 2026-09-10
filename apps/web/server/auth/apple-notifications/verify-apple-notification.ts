import { createHash } from "node:crypto";

import {
  createRemoteJWKSet,
  decodeJwt,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");
const MAX_TOKEN_BYTES = 16 * 1024;
const CLOCK_TOLERANCE_SECONDS = 60;
const MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;
const EVENT_TIME_MILLISECONDS_BOUNDARY = 1_000_000_000_000;

export const APPLE_NOTIFICATION_AUDIENCES = ["kr.byus.web", "kr.byus.app"] as const;
export const APPLE_NOTIFICATION_TYPES = [
  "email-enabled",
  "email-disabled",
  "consent-revoked",
  "account-deleted",
] as const;

export type AppleNotificationAudience = (typeof APPLE_NOTIFICATION_AUDIENCES)[number];
export type AppleNotificationType = (typeof APPLE_NOTIFICATION_TYPES)[number];

/**
 * A cryptographically verified and semantically normalized Apple account event.
 * `issuedAt` remains a JWT NumericDate in seconds. `eventTime` is normalized to
 * integer milliseconds so Apple's second and millisecond payloads preserve order.
 * `eventId` is Apple's required `jti`; callers can use it as the durable deduplication key.
 */
export interface VerifiedAppleNotification {
  eventId: string;
  type: AppleNotificationType;
  subject: string;
  audience: AppleNotificationAudience;
  issuedAt: number;
  eventTime: number;
  email: string | null;
  isPrivateEmail: true | null;
  payloadHash: string;
}

export interface AppleNotificationVerifierOptions {
  trustedAudiences: readonly AppleNotificationAudience[];
  getKey?: JWTVerifyGetKey;
  now?: () => number;
}

export const APPLE_NOTIFICATION_REJECTION_REASONS = [
  "TOKEN_FORMAT",
  "JWT_ALGORITHM",
  "JWT_KEY",
  "JWT_SIGNATURE",
  "JWT_CLAIM_MISSING",
  "JWT_CLAIM_INVALID",
  "EVENT_SHAPE",
  "EVENT_TYPE",
  "JTI_FORMAT",
  "SUBJECT_FORMAT",
  "IAT_NOT_POSITIVE_INTEGER",
  "IAT_FUTURE",
  "IAT_TOO_OLD",
  "EVENT_TIME_NOT_POSITIVE_INTEGER",
  "EVENT_TIME_UNSUPPORTED_RANGE",
  "EVENT_TIME_FUTURE",
  "EVENT_TIME_AFTER_IAT",
  "PRIVATE_RELAY_FORMAT",
  "VERIFIER_CONFIGURATION",
] as const;

export type AppleNotificationRejectionReason =
  (typeof APPLE_NOTIFICATION_REJECTION_REASONS)[number];

export type AppleNotificationClaimName =
  | "aud"
  | "events"
  | "exp"
  | "iat"
  | "iss"
  | "jti"
  | "nbf"
  | "sub"
  | "typ"
  | "other";

export type AppleNotificationDiagnosticValueType =
  | "array"
  | "null"
  | "number"
  | "object"
  | "other"
  | "string";

export interface AppleNotificationDiagnostic {
  claim?: AppleNotificationClaimName;
  issuer?: string;
  audience?: readonly string[];
  issuedAt?: number;
  eventTime?: number;
  now?: number;
  valueType?: AppleNotificationDiagnosticValueType;
  numericValue?: number;
}

const SAFE_CLIENT_IDENTIFIER = /^(?=.{1,128}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/u;
const DIAGNOSTIC_CLAIMS = new Set<AppleNotificationClaimName>([
  "aud", "events", "exp", "iat", "iss", "jti", "nbf", "sub", "typ", "other",
]);

function sanitizeClaimName(value: unknown): AppleNotificationClaimName | undefined {
  return typeof value === "string" && DIAGNOSTIC_CLAIMS.has(value as AppleNotificationClaimName)
    ? value as AppleNotificationClaimName
    : undefined;
}

function sanitizeIssuer(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function sanitizeAudience(value: unknown): readonly string[] | undefined {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  if (values.length < 1 || values.length > 4) return undefined;
  if (!values.every((item) => typeof item === "string" && SAFE_CLIENT_IDENTIFIER.test(item))) return undefined;
  return Object.freeze(values as string[]);
}

function sanitizeDiagnostic(value: AppleNotificationDiagnostic): AppleNotificationDiagnostic {
  const diagnostic: AppleNotificationDiagnostic = {};
  const claim = sanitizeClaimName(value.claim);
  const issuer = sanitizeIssuer(value.issuer);
  const audience = sanitizeAudience(value.audience);
  if (claim) diagnostic.claim = claim;
  if (issuer) diagnostic.issuer = issuer;
  if (audience) diagnostic.audience = audience;
  if (Number.isSafeInteger(value.issuedAt) && (value.issuedAt as number) > 0) diagnostic.issuedAt = value.issuedAt;
  if (Number.isSafeInteger(value.eventTime) && (value.eventTime as number) > 0) diagnostic.eventTime = value.eventTime;
  if (Number.isSafeInteger(value.now) && (value.now as number) > 0) diagnostic.now = value.now;
  if (["array", "null", "number", "object", "other", "string"].includes(value.valueType ?? "")) {
    diagnostic.valueType = value.valueType;
  }
  if (typeof value.numericValue === "number" && Number.isFinite(value.numericValue)) {
    diagnostic.numericValue = value.numericValue;
  }
  return diagnostic;
}

function valueDiagnostic(value: unknown): AppleNotificationDiagnostic {
  let valueType: AppleNotificationDiagnosticValueType;
  if (value === null) valueType = "null";
  else if (Array.isArray(value)) valueType = "array";
  else if (typeof value === "string") valueType = "string";
  else if (typeof value === "number") valueType = "number";
  else if (typeof value === "object") valueType = "object";
  else valueType = "other";
  return {
    valueType,
    ...(typeof value === "number" && Number.isFinite(value) ? { numericValue: value } : {}),
  };
}

export class InvalidAppleNotificationError extends Error {
  readonly code = "INVALID_APPLE_NOTIFICATION";
  readonly reason: AppleNotificationRejectionReason;
  readonly diagnostic: Readonly<AppleNotificationDiagnostic>;

  constructor(
    reason: AppleNotificationRejectionReason = "TOKEN_FORMAT",
    diagnostic: AppleNotificationDiagnostic = {},
  ) {
    super("Invalid Apple notification");
    this.name = "InvalidAppleNotificationError";
    this.reason = reason;
    this.diagnostic = Object.freeze(sanitizeDiagnostic(diagnostic));
  }
}

export class AppleNotificationUnavailableError extends Error {
  readonly code = "APPLE_NOTIFICATION_VERIFICATION_UNAVAILABLE";

  constructor() {
    super("Apple notification verification is temporarily unavailable");
    this.name = "AppleNotificationUnavailableError";
  }
}

const appleRemoteJwks = createRemoteJWKSet(APPLE_JWKS_URL, {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

function invalid(
  reason: AppleNotificationRejectionReason,
  diagnostic: AppleNotificationDiagnostic = {},
): never {
  throw new InvalidAppleNotificationError(reason, diagnostic);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  maximumLength: number,
  reason: AppleNotificationRejectionReason,
): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength || value.trim() !== value) invalid(reason);
  return value;
}

function positiveInteger(value: unknown, reason: AppleNotificationRejectionReason): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(reason, valueDiagnostic(value));
  return value as number;
}

function normalizeEventTime(value: unknown): { eventTime: number; rawEventTime: number } {
  const rawEventTime = positiveInteger(value, "EVENT_TIME_NOT_POSITIVE_INTEGER");
  const eventTime = rawEventTime < EVENT_TIME_MILLISECONDS_BOUNDARY
    ? rawEventTime * 1000
    : rawEventTime;
  if (!Number.isSafeInteger(eventTime) || eventTime < EVENT_TIME_MILLISECONDS_BOUNDARY) {
    invalid("EVENT_TIME_UNSUPPORTED_RANGE", { eventTime: rawEventTime });
  }
  return { eventTime, rawEventTime };
}

function parseEvents(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      invalid("EVENT_SHAPE", valueDiagnostic(value));
    }
  }
  if (!isRecord(parsed)) invalid("EVENT_SHAPE", valueDiagnostic(parsed));
  return parsed;
}

function parseEventType(value: unknown): AppleNotificationType {
  if (
    typeof value !== "string" ||
    !APPLE_NOTIFICATION_TYPES.includes(value as AppleNotificationType)
  ) {
    invalid("EVENT_TYPE");
  }
  return value as AppleNotificationType;
}

function parseRelayEmail(events: Record<string, unknown>): string {
  const email = boundedString(events.email, 320, "PRIVATE_RELAY_FORMAT").toLowerCase();
  if (email.length < 3 || email.length > 320 || /[\s\r\n]/u.test(email)) invalid("PRIVATE_RELAY_FORMAT");

  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) invalid("PRIVATE_RELAY_FORMAT");
  if (email.slice(at + 1) !== "privaterelay.appleid.com") invalid("PRIVATE_RELAY_FORMAT");

  const privateEmail = events.is_private_email;
  if (privateEmail !== true && privateEmail !== "true") invalid("PRIVATE_RELAY_FORMAT");
  return email;
}

function parseAudience(
  payload: JWTPayload,
  trustedAudiences: readonly AppleNotificationAudience[],
): AppleNotificationAudience {
  if (typeof payload.aud !== "string" || !trustedAudiences.includes(payload.aud as AppleNotificationAudience)) {
    invalid("JWT_CLAIM_INVALID", {
      claim: "aud",
      ...publicIdentifierDiagnostic(payload),
    });
  }
  return payload.aud as AppleNotificationAudience;
}

function validateTrustedAudiences(
  audiences: readonly AppleNotificationAudience[],
): readonly AppleNotificationAudience[] {
  if (
    audiences.length < 1 ||
    audiences.some(
      (audience) => !APPLE_NOTIFICATION_AUDIENCES.includes(audience as AppleNotificationAudience),
    )
  ) {
    invalid("VERIFIER_CONFIGURATION");
  }
  return audiences;
}

function verifiedClaimDiagnostic(token: string, claim: string): AppleNotificationDiagnostic {
  const diagnostic: AppleNotificationDiagnostic = {
    claim: sanitizeClaimName(claim) ?? "other",
  };
  try {
    // jose 6.1.3 runs compact JWS verification before jwtPayload claim checks.
    // Only a claim-validation error therefore authorizes decoding public identifiers.
    const payload = decodeJwt(token);
    Object.assign(diagnostic, publicIdentifierDiagnostic(payload));
    if (claim === "iat") Object.assign(diagnostic, valueDiagnostic(payload.iat));
  } catch {
    // The fixed claim name remains useful without copying decode failure details.
  }
  return diagnostic;
}

function publicIdentifierDiagnostic(payload: JWTPayload): AppleNotificationDiagnostic {
  const diagnostic: AppleNotificationDiagnostic = {};
  const issuer = sanitizeIssuer(payload.iss);
  const audience = sanitizeAudience(payload.aud);
  if (issuer) diagnostic.issuer = issuer;
  if (audience) diagnostic.audience = audience;
  return diagnostic;
}

function mapVerificationError(error: unknown, token: string): never {
  if (error instanceof InvalidAppleNotificationError) throw error;

  // Signature, algorithm, token-shape, claim, and key-selection failures describe
  // untrusted input. A JWKS timeout, malformed/non-200 Apple response, or transport
  // exception is retryable provider availability instead.
  if (error instanceof joseErrors.JOSEError) {
    if (error.code === "ERR_JWKS_TIMEOUT" || error.code === "ERR_JOSE_GENERIC") {
      throw new AppleNotificationUnavailableError();
    }
    if (
      error instanceof joseErrors.JWTClaimValidationFailed ||
      error instanceof joseErrors.JWTExpired
    ) {
      throw new InvalidAppleNotificationError(
        error.claim === "iat" && error.reason === "invalid"
          ? "IAT_NOT_POSITIVE_INTEGER"
          : error.reason === "missing" ? "JWT_CLAIM_MISSING" : "JWT_CLAIM_INVALID",
        verifiedClaimDiagnostic(token, error.claim),
      );
    }
    if (
      error.code === "ERR_JOSE_ALG_NOT_ALLOWED" ||
      error.code === "ERR_JOSE_NOT_SUPPORTED"
    ) {
      throw new InvalidAppleNotificationError("JWT_ALGORITHM");
    }
    if (
      error.code === "ERR_JWK_INVALID" ||
      error.code === "ERR_JWKS_INVALID" ||
      error.code === "ERR_JWKS_NO_MATCHING_KEY" ||
      error.code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS"
    ) {
      throw new InvalidAppleNotificationError("JWT_KEY");
    }
    if (error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      throw new InvalidAppleNotificationError("JWT_SIGNATURE");
    }
    throw new InvalidAppleNotificationError("TOKEN_FORMAT");
  }
  throw new AppleNotificationUnavailableError();
}

export async function verifyAppleNotification(
  token: string,
  options: AppleNotificationVerifierOptions,
): Promise<VerifiedAppleNotification> {
  if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) invalid("TOKEN_FORMAT");

  const trustedAudiences = [...validateTrustedAudiences(options.trustedAudiences)];
  const now = Math.floor(options.now?.() ?? Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now <= 0) invalid("VERIFIER_CONFIGURATION");

  let verified: { payload: JWTPayload; protectedHeader: { alg?: string } };
  try {
    verified = await jwtVerify(token, options.getKey ?? appleRemoteJwks, {
      algorithms: ["RS256"],
      issuer: APPLE_ISSUER,
      audience: trustedAudiences,
      requiredClaims: ["iss", "aud", "iat", "jti", "events"],
      currentDate: new Date(now * 1000),
    });
  } catch (error) {
    mapVerificationError(error, token);
  }

  const { payload, protectedHeader } = verified;
  if (protectedHeader.alg !== "RS256") invalid("JWT_ALGORITHM");

  const audience = parseAudience(payload, trustedAudiences);
  const issuedAt = positiveInteger(payload.iat, "IAT_NOT_POSITIVE_INTEGER");
  const eventId = boundedString(payload.jti, 256, "JTI_FORMAT");
  const events = parseEvents(payload.events);
  const type = parseEventType(events.type);
  const subject = boundedString(events.sub, 256, "SUBJECT_FORMAT");
  const { eventTime, rawEventTime } = normalizeEventTime(events.event_time);

  if (issuedAt > now + CLOCK_TOLERANCE_SECONDS) invalid("IAT_FUTURE", { issuedAt, now });
  if (eventTime > (now + CLOCK_TOLERANCE_SECONDS) * 1000) {
    invalid("EVENT_TIME_FUTURE", { eventTime: rawEventTime, now });
  }
  if (eventTime > (issuedAt + CLOCK_TOLERANCE_SECONDS) * 1000) {
    invalid("EVENT_TIME_AFTER_IAT", { issuedAt, eventTime: rawEventTime });
  }

  // Local replay-exposure policy, not an age guarantee made by Apple. Database
  // ordering still decides whether a verified delayed event changes current state.
  if (issuedAt < now - MAX_EVENT_AGE_SECONDS) invalid("IAT_TOO_OLD", { issuedAt, now });

  const isEmailEvent = type === "email-enabled" || type === "email-disabled";
  const email = isEmailEvent ? parseRelayEmail(events) : null;

  return {
    eventId,
    type,
    subject,
    audience,
    issuedAt,
    eventTime,
    email,
    isPrivateEmail: isEmailEvent ? true : null,
    payloadHash: createHash("sha256").update(token, "utf8").digest("hex"),
  };
}
