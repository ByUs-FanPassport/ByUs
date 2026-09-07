import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { newSecret, secretHash, tokenVault, verifyInstagramSignedRequest } from "./crypto";

describe("Instagram secret storage", () => {
  it("uses random authenticated ciphertext bound to the specific celebrity/account", () => {
    const vault = tokenVault(Buffer.alloc(32, 7).toString("base64"));
    const first = vault.seal("private-token", "celebrity:account");
    expect(first).not.toContain("private-token");
    expect(vault.seal("private-token", "celebrity:account")).not.toBe(first);
    expect(vault.open(first, "celebrity:account")).toBe("private-token");
    expect(() => vault.open(first, "other:account")).toThrow("Instagram token unavailable");
    expect(() => vault.open(first.replace("v1", "v2"), "celebrity:account")).toThrow();
    expect(() => tokenVault("short")).toThrow();
  });
  it("generates non-reusable opaque secrets and stores only their hashes", () => {
    const value = newSecret();
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(value);
    expect(secretHash(value)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Meta signed deletion requests", () => {
  const now = Date.parse("2026-09-08T00:00:00Z");
  const secret = "test-app-secret";
  function sign(payload: unknown) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${createHmac("sha256", secret).update(encoded).digest("base64url")}.${encoded}`;
  }
  it("verifies authentic delayed deletion and rejects tampering/future payloads", () => {
    const payload = { algorithm: "HMAC-SHA256", user_id: "102000000000001", issued_at: now / 1000 };
    expect(verifyInstagramSignedRequest(sign(payload), secret, now)).toEqual(payload);
    expect(() => verifyInstagramSignedRequest(sign(payload), "wrong", now)).toThrow();
    expect(verifyInstagramSignedRequest(sign({ ...payload, issued_at: now / 1000 - 90000 }), secret, now).user_id).toBe(payload.user_id);
    expect(() => verifyInstagramSignedRequest(sign({ ...payload, issued_at: now / 1000 + 120 }), secret, now)).toThrow();
    expect(() => verifyInstagramSignedRequest(sign({ ...payload, algorithm: "none" }), secret, now)).toThrow();
  });
});
