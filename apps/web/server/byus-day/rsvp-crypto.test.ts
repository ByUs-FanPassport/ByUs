import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptResidentRegistrationNumber, parseRsvpEncryptionKey, rsvpEncryptionAad } from "./rsvp-crypto";

const key = Buffer.alloc(32, 9);
const canonicalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function decrypt(envelope: string, id = canonicalId): string {
  const [, nonce, tag, ciphertext] = envelope.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce!, "base64url"));
  decipher.setAAD(rsvpEncryptionAad(id));
  decipher.setAuthTag(Buffer.from(tag!, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext!, "base64url")), decipher.final()]).toString("utf8");
}

describe("RSVP resident registration encryption", () => {
  it("uses a canonical UUID-bound AES-256-GCM envelope", () => {
    const encrypted = encryptResidentRegistrationNumber("9001011234567", canonicalId.toUpperCase(), key);
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{18}$/u);
    expect(decrypt(encrypted)).toBe("9001011234567");
    expect(encrypted).not.toContain("9001011234567");
  });

  it("rejects a wrong UUID or tampered ciphertext", () => {
    const encrypted = encryptResidentRegistrationNumber("9001011234567", canonicalId, key);
    expect(() => decrypt(encrypted, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toThrow();
    const parts = encrypted.split("."); parts[3] = `${parts[3]!.startsWith("A") ? "B" : "A"}${parts[3]!.slice(1)}`;
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("accepts only a canonical base64 32-byte key", () => {
    expect(parseRsvpEncryptionKey(key.toString("base64"))).toEqual(key);
    expect(() => parseRsvpEncryptionKey(`${key.toString("base64")}\n`)).toThrow("RSVP_ENCRYPTION_KEY_INVALID");
  });
});
