import { TextEncoder as NodeTextEncoder } from "node:util";

import type { CryptoKey, JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { AppleNotificationType } from "./verify-apple-notification";

const NOW = 1_789_000_000;
const KID = "apple-test-key";
const AUDIENCE = "kr.byus.web" as const;

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let getKey: ReturnType<typeof import("jose").createLocalJWKSet>;
let SignJWT: typeof import("jose").SignJWT;
let verifyAppleNotification: typeof import("./verify-apple-notification").verifyAppleNotification;
let InvalidAppleNotificationError: typeof import("./verify-apple-notification").InvalidAppleNotificationError;
let AppleNotificationUnavailableError: typeof import("./verify-apple-notification").AppleNotificationUnavailableError;

beforeAll(async () => {
  // jsdom supplies a cross-realm TextEncoder whose output jose intentionally
  // rejects. Load jose only after pinning Node's encoder for these crypto tests.
  const NodeUint8Array = new NodeTextEncoder().encode("").constructor;
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    value: NodeUint8Array,
  });
  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: NodeTextEncoder,
  });
  const jose = await import("jose");
  const verifier = await import("./verify-apple-notification");
  SignJWT = jose.SignJWT;
  verifyAppleNotification = verifier.verifyAppleNotification;
  InvalidAppleNotificationError = verifier.InvalidAppleNotificationError;
  AppleNotificationUnavailableError = verifier.AppleNotificationUnavailableError;

  const { createLocalJWKSet, exportJWK, generateKeyPair } = jose;
  const primary = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = primary.privateKey;
  otherPrivateKey = other.privateKey;
  getKey = createLocalJWKSet({
    keys: [{ ...(await exportJWK(primary.publicKey)), kid: KID, alg: "RS256", use: "sig" }],
  });
});

function baseEvents(type: AppleNotificationType = "consent-revoked") {
  return {
    type,
    sub: "apple-subject-1",
    event_time: NOW - 5,
    ...(type === "email-enabled" || type === "email-disabled"
      ? { email: "Relay.User@PrivateRelay.AppleID.com", is_private_email: "true" }
      : {}),
  };
}

function baseClaims(overrides: Partial<JWTPayload> = {}): JWTPayload {
  return {
    iss: "https://appleid.apple.com",
    aud: AUDIENCE,
    iat: NOW - 5,
    jti: "event-1",
    events: baseEvents(),
    ...overrides,
  };
}

async function sign(
  claims: JWTPayload = baseClaims(),
  key: CryptoKey = privateKey,
  header: { alg: string; kid?: string } = { alg: "RS256", kid: KID },
): Promise<string> {
  return new SignJWT(claims).setProtectedHeader(header).sign(key);
}

async function verify(token: string) {
  return verifyAppleNotification(token, {
    trustedAudiences: [AUDIENCE],
    getKey,
    now: () => NOW,
  });
}

function unsigned(claims: JWTPayload): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.`;
}

describe("verifyAppleNotification", () => {
  it.each(["email-enabled", "email-disabled", "consent-revoked", "account-deleted"] as const)(
    "verifies and normalizes Apple's %s event",
    async (type) => {
      const result = await verify(await sign(baseClaims({ events: baseEvents(type) })));

      expect(result).toMatchObject({
        eventId: "event-1",
        type,
        subject: "apple-subject-1",
        audience: AUDIENCE,
        issuedAt: NOW - 5,
        eventTime: NOW - 5,
        email: type.startsWith("email-") ? "relay.user@privaterelay.appleid.com" : null,
        isPrivateEmail: type.startsWith("email-") ? true : null,
      });
      expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/u);
    },
  );

  it("accepts events as an object or a historical JSON string", async () => {
    await expect(verify(await sign(baseClaims({ events: baseEvents() })))).resolves.toMatchObject({
      type: "consent-revoked",
    });
    await expect(
      verify(await sign(baseClaims({ events: JSON.stringify(baseEvents("account-deleted")) }))),
    ).resolves.toMatchObject({ type: "account-deleted" });
  });

  it("accepts the app audience and boolean private-email marker when explicitly trusted", async () => {
    const events = {
      ...baseEvents("email-enabled"),
      is_private_email: true,
    };
    const token = await sign(baseClaims({ aud: "kr.byus.app", events }));

    await expect(
      verifyAppleNotification(token, {
        trustedAudiences: ["kr.byus.app"],
        getKey,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      audience: "kr.byus.app",
      email: "relay.user@privaterelay.appleid.com",
      isPrivateEmail: true,
    });
  });

  it("diagnoses a signed audience array rejected by the normalized event contract", async () => {
    const token = await sign(baseClaims({ aud: [AUDIENCE, "kr.byus.app"] }));
    await expect(verify(token)).rejects.toMatchObject({
      reason: "JWT_CLAIM_INVALID",
      diagnostic: {
        claim: "aud",
        issuer: "https://appleid.apple.com",
        audience: [AUDIENCE, "kr.byus.app"],
      },
    });
  });

  it("does not require exp but validates it when present", async () => {
    await expect(verify(await sign())).resolves.toMatchObject({ eventId: "event-1" });
    await expect(
      verify(await sign(baseClaims({ exp: NOW - 1 }))),
    ).rejects.toBeInstanceOf(InvalidAppleNotificationError);
  });

  it.each([
    ["issuer", { iss: "https://attacker.example" }],
    ["audience", { aud: "attacker.app" }],
  ] as const)("distinguishes the wrong %s after signature verification", async (label, overrides) => {
    await expect(verify(await sign(baseClaims(overrides)))).rejects.toMatchObject({
      message: "Invalid Apple notification",
      reason: "JWT_CLAIM_INVALID",
      diagnostic: {
        claim: label === "issuer" ? "iss" : "aud",
        issuer: label === "issuer" ? "https://attacker.example" : "https://appleid.apple.com",
        audience: label === "audience" ? ["attacker.app"] : [AUDIENCE],
      },
    });
  });

  it("rejects an unknown signing key and a bad RSA signature", async () => {
    await expect(
      verify(await sign(baseClaims(), privateKey, { alg: "RS256", kid: "unknown" })),
    ).rejects.toBeInstanceOf(InvalidAppleNotificationError);
    await expect(verify(await sign(baseClaims(), otherPrivateKey))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
  });

  it("distinguishes key, signature, and algorithm failures", async () => {
    await expect(
      verify(await sign(baseClaims(), privateKey, { alg: "RS256", kid: "unknown" })),
    ).rejects.toMatchObject({ reason: "JWT_KEY", diagnostic: {} });
    await expect(verify(await sign(baseClaims(), otherPrivateKey))).rejects.toMatchObject({
      reason: "JWT_SIGNATURE",
      diagnostic: {},
    });

    const secret = new TextEncoder().encode("a sufficiently long test-only shared secret");
    const hs256 = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .sign(secret);
    await expect(verify(hs256)).rejects.toMatchObject({
      reason: "JWT_ALGORITHM",
      diagnostic: {},
    });
  });

  it("rejects HS256 and unsecured tokens before accepting their contents", async () => {
    const secret = new TextEncoder().encode("a sufficiently long test-only shared secret");
    const hs256 = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .sign(secret);

    await expect(verify(hs256)).rejects.toBeInstanceOf(InvalidAppleNotificationError);
    await expect(verify(unsigned(baseClaims()))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
  });

  it.each(["iss", "aud", "iat", "jti", "events"] as const)(
    "requires the %s claim",
    async (claim) => {
      const claims = baseClaims();
      delete claims[claim];
      await expect(verify(await sign(claims))).rejects.toBeInstanceOf(
        InvalidAppleNotificationError,
      );
    },
  );

  it("preserves a fixed claim name after a signed token misses a required claim", async () => {
    const claims = baseClaims();
    delete claims.jti;
    await expect(verify(await sign(claims))).rejects.toMatchObject({
      reason: "JWT_CLAIM_MISSING",
      diagnostic: {
        claim: "jti",
        issuer: "https://appleid.apple.com",
        audience: [AUDIENCE],
      },
    });
  });

  it.each([
    ["future iat", { iat: NOW + 61 }],
    ["non-integer iat", { iat: NOW - 0.5 }],
    ["non-positive iat", { iat: 0 }],
    ["older than local maximum age", { iat: NOW - 7 * 24 * 60 * 60 - 1 }],
  ] as const)("rejects %s", async (_label, overrides) => {
    await expect(verify(await sign(baseClaims(overrides)))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
  });

  it.each([
    ["future event time", { ...baseEvents(), event_time: NOW + 61 }],
    ["event after iat tolerance", { ...baseEvents(), event_time: NOW + 56 }],
    ["non-integer event time", { ...baseEvents(), event_time: NOW - 0.5 }],
    ["non-positive event time", { ...baseEvents(), event_time: 0 }],
  ] as const)("rejects %s", async (_label, events) => {
    await expect(verify(await sign(baseClaims({ events })))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
  });

  it("distinguishes future and millisecond-like event timestamps without changing rejection", async () => {
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), event_time: NOW + 61 } }))),
    ).rejects.toMatchObject({
      reason: "EVENT_TIME_FUTURE",
      diagnostic: { eventTime: NOW + 61, now: NOW },
    });
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), event_time: NOW * 1000 } }))),
    ).rejects.toMatchObject({
      reason: "EVENT_TIME_FUTURE",
      diagnostic: { eventTime: NOW * 1000, now: NOW },
    });
  });

  it("distinguishes timestamp integer, ordering, and age policies", async () => {
    await expect(verify(await sign(baseClaims({ iat: 0 })))).rejects.toMatchObject({
      reason: "IAT_NOT_POSITIVE_INTEGER",
      diagnostic: { valueType: "number", numericValue: 0 },
    });
    await expect(
      verify(await sign(baseClaims({ iat: "invalid" as unknown as number }))),
    ).rejects.toMatchObject({
      reason: "IAT_NOT_POSITIVE_INTEGER",
      diagnostic: { claim: "iat", valueType: "string" },
    });
    await expect(verify(await sign(baseClaims({ iat: NOW + 61 })))).rejects.toMatchObject({
      reason: "IAT_FUTURE",
      diagnostic: { issuedAt: NOW + 61, now: NOW },
    });
    await expect(
      verify(await sign(baseClaims({
        iat: NOW - 7 * 24 * 60 * 60 - 1,
        events: { ...baseEvents(), event_time: NOW - 7 * 24 * 60 * 60 - 1 },
      }))),
    ).rejects.toMatchObject({ reason: "IAT_TOO_OLD" });
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), event_time: 0 } }))),
    ).rejects.toMatchObject({
      reason: "EVENT_TIME_NOT_POSITIVE_INTEGER",
      diagnostic: { valueType: "number", numericValue: 0 },
    });
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), event_time: NOW + 56 } }))),
    ).rejects.toMatchObject({ reason: "EVENT_TIME_AFTER_IAT" });
  });

  it.each([
    ["array", []],
    ["malformed JSON string", "{"],
    ["JSON array string", "[]"],
    ["unknown type", { ...baseEvents(), type: "profile-updated" }],
    ["missing subject", { type: "account-deleted", event_time: NOW - 5 }],
  ])("rejects malformed events: %s", async (_label, events) => {
    await expect(verify(await sign(baseClaims({ events })))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
  });

  it("distinguishes malformed event JSON from an unsupported event type", async () => {
    await expect(verify(await sign(baseClaims({ events: "{" })))).rejects.toMatchObject({
      reason: "EVENT_SHAPE",
      diagnostic: { valueType: "string" },
    });
    await expect(verify(await sign(baseClaims({ events: 123 })))).rejects.toMatchObject({
      reason: "EVENT_SHAPE",
      diagnostic: { valueType: "number", numericValue: 123 },
    });
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), type: "profile-updated" } }))),
    ).rejects.toMatchObject({ reason: "EVENT_TYPE", diagnostic: {} });
  });

  it.each([
    ["normal email", { email: "fan@example.com", is_private_email: true }],
    ["relay subdomain", { email: "fan@sub.privaterelay.appleid.com", is_private_email: true }],
    ["false boolean", { email: "fan@privaterelay.appleid.com", is_private_email: false }],
    ["false string", { email: "fan@privaterelay.appleid.com", is_private_email: "false" }],
    ["malformed email", { email: "bad@@privaterelay.appleid.com", is_private_email: true }],
    ["surrounding whitespace", { email: " fan@privaterelay.appleid.com ", is_private_email: true }],
  ])("rejects email event with %s", async (_label, emailFields) => {
    const events = { ...baseEvents("email-enabled"), ...emailFields };
    await expect(verify(await sign(baseClaims({ events })))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
  });

  it("enforces bounded token, event ID, subject, and email fields", async () => {
    await expect(verify("x".repeat(16 * 1024 + 1))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
    await expect(verify(await sign(baseClaims({ jti: "j".repeat(257) })))).rejects.toBeInstanceOf(
      InvalidAppleNotificationError,
    );
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), sub: "s".repeat(257) } }))),
    ).rejects.toBeInstanceOf(InvalidAppleNotificationError);
    await expect(
      verify(
        await sign(baseClaims({
          events: {
            ...baseEvents("email-disabled"),
            email: `${"a".repeat(300)}@privaterelay.appleid.com`,
          },
        })),
      ),
    ).rejects.toBeInstanceOf(InvalidAppleNotificationError);
  });

  it("distinguishes event ID, subject, and private relay formats", async () => {
    await expect(
      verify(await sign(baseClaims({ jti: "j".repeat(257) }))),
    ).rejects.toMatchObject({ reason: "JTI_FORMAT" });
    await expect(
      verify(await sign(baseClaims({ events: { ...baseEvents(), sub: "s".repeat(257) } }))),
    ).rejects.toMatchObject({ reason: "SUBJECT_FORMAT" });
    await expect(
      verify(await sign(baseClaims({
        events: {
          ...baseEvents("email-disabled"),
          email: "fan@example.com",
          is_private_email: true,
        },
      }))),
    ).rejects.toMatchObject({ reason: "PRIVATE_RELAY_FORMAT" });
  });

  it("rejects an arbitrary configured audience even when the token matches it", async () => {
    const token = await sign(baseClaims({ aud: "attacker.app" }));
    await expect(
      verifyAppleNotification(token, {
        trustedAudiences: ["attacker.app"] as unknown as ["kr.byus.web"],
        getKey,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidAppleNotificationError);
  });

  it("returns the same payload hash for replayed identical bytes without claiming DB deduplication", async () => {
    const token = await sign();
    const first = await verify(token);
    const replay = await verify(token);
    expect(replay.payloadHash).toBe(first.payloadHash);
    expect(replay.eventId).toBe(first.eventId);
  });

  it("classifies a JWKS transport failure as transient without exposing its details", async () => {
    const token = await sign();
    const failure = verifyAppleNotification(token, {
      trustedAudiences: [AUDIENCE],
      getKey: async () => {
        throw new TypeError("fetch failed for secret upstream detail");
      },
      now: () => NOW,
    });

    await expect(failure).rejects.toBeInstanceOf(AppleNotificationUnavailableError);
    await expect(failure).rejects.not.toThrow(/secret|fetch failed/u);
  });
});
