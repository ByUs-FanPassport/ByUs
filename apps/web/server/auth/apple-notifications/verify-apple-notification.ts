import { createHash } from "node:crypto";

import {
  createRemoteJWKSet,
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
 * Timestamps remain integer JWT NumericDate values (seconds since the Unix epoch).
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

export class InvalidAppleNotificationError extends Error {
  readonly code = "INVALID_APPLE_NOTIFICATION";

  constructor() {
    super("Invalid Apple notification");
    this.name = "InvalidAppleNotificationError";
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

function invalid(): never {
  throw new InvalidAppleNotificationError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength || value.trim() !== value) invalid();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid();
  return value as number;
}

function parseEvents(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      invalid();
    }
  }
  if (!isRecord(parsed)) invalid();
  return parsed;
}

function parseEventType(value: unknown): AppleNotificationType {
  if (
    typeof value !== "string" ||
    !APPLE_NOTIFICATION_TYPES.includes(value as AppleNotificationType)
  ) {
    invalid();
  }
  return value as AppleNotificationType;
}

function parseRelayEmail(events: Record<string, unknown>): string {
  const email = boundedString(events.email, 320).toLowerCase();
  if (email.length < 3 || email.length > 320 || /[\s\r\n]/u.test(email)) invalid();

  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) invalid();
  if (email.slice(at + 1) !== "privaterelay.appleid.com") invalid();

  const privateEmail = events.is_private_email;
  if (privateEmail !== true && privateEmail !== "true") invalid();
  return email;
}

function parseAudience(
  payload: JWTPayload,
  trustedAudiences: readonly AppleNotificationAudience[],
): AppleNotificationAudience {
  if (typeof payload.aud !== "string" || !trustedAudiences.includes(payload.aud as AppleNotificationAudience)) {
    invalid();
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
    invalid();
  }
  return audiences;
}

function mapVerificationError(error: unknown): never {
  if (error instanceof InvalidAppleNotificationError) throw error;

  // Signature, algorithm, token-shape, claim, and key-selection failures describe
  // untrusted input. A JWKS timeout, malformed/non-200 Apple response, or transport
  // exception is retryable provider availability instead.
  if (error instanceof joseErrors.JOSEError) {
    if (error.code === "ERR_JWKS_TIMEOUT" || error.code === "ERR_JOSE_GENERIC") {
      throw new AppleNotificationUnavailableError();
    }
    throw new InvalidAppleNotificationError();
  }
  throw new AppleNotificationUnavailableError();
}

export async function verifyAppleNotification(
  token: string,
  options: AppleNotificationVerifierOptions,
): Promise<VerifiedAppleNotification> {
  if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) invalid();

  const trustedAudiences = [...validateTrustedAudiences(options.trustedAudiences)];
  const now = Math.floor(options.now?.() ?? Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now <= 0) invalid();

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
    mapVerificationError(error);
  }

  const { payload, protectedHeader } = verified;
  if (protectedHeader.alg !== "RS256") invalid();

  const audience = parseAudience(payload, trustedAudiences);
  const issuedAt = positiveInteger(payload.iat);
  const eventId = boundedString(payload.jti, 256);
  const events = parseEvents(payload.events);
  const type = parseEventType(events.type);
  const subject = boundedString(events.sub, 256);
  const eventTime = positiveInteger(events.event_time);

  if (issuedAt > now + CLOCK_TOLERANCE_SECONDS) invalid();
  if (eventTime > now + CLOCK_TOLERANCE_SECONDS) invalid();
  if (eventTime > issuedAt + CLOCK_TOLERANCE_SECONDS) invalid();

  // Local replay-exposure policy, not an age guarantee made by Apple. Database
  // ordering still decides whether a verified delayed event changes current state.
  if (issuedAt < now - MAX_EVENT_AGE_SECONDS) invalid();

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
