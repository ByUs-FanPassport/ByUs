import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { instagramId } from "./model";

export const newSecret = () => randomBytes(32).toString("base64url");
export const secretHash = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function tokenVault(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) throw new Error("Invalid Instagram encryption key");
  return {
    seal(token: string, binding: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(binding));
      const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
    },
    open(value: string, binding: string): string {
      try {
        const [version, nonce, tag, encrypted, extra] = value.split(".");
        if (version !== "v1" || !nonce || !tag || !encrypted || extra) throw new Error();
        const iv = Buffer.from(nonce, "base64url");
        const authTag = Buffer.from(tag, "base64url");
        if (iv.length !== 12 || authTag.length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(binding));
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        throw new Error("Instagram token unavailable");
      }
    },
  };
}

// Store neither the signed body nor the provider token in request/error logs.
export function verifyInstagramSignedRequest(value: string, secret: string, now = Date.now()) {
  if (value.length > 16384) throw new Error("Invalid signed request");
  const pieces = value.split(".");
  if (pieces.length !== 2 || pieces.some((piece) => !/^[A-Za-z0-9_-]+$/.test(piece))) throw new Error("Invalid signed request");
  const [signature, payload] = pieces;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!constantTimeEqual(signature, expected)) throw new Error("Invalid signed request");
  const parsed = z.object({
    algorithm: z.literal("HMAC-SHA256"),
    user_id: instagramId,
    issued_at: z.number().int().positive(),
  }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  // Historical signed requests must not revoke a newly reconnected account.
  // Authentic delayed deletion deliveries remain valid. The DB compares their
  // event time with immutable OAuth start time instead of rejecting old events.
  if (parsed.issued_at * 1000 > now + 60_000) throw new Error("Invalid signed request time");
  return parsed;
}
