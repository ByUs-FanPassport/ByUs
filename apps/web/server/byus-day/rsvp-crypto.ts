import { createCipheriv, randomBytes } from "node:crypto";

const EVENT_AAD = "byus-day-rsvp:v1:event=2026-10-22:id=";

export function parseRsvpEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new Error("RSVP_ENCRYPTION_KEY_INVALID");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("RSVP_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptResidentRegistrationNumber(value: string, idempotencyKey: string, key: Buffer): string {
  if (!/^\d{13}$/u.test(value) || key.length !== 32) throw new Error("RSVP_ENCRYPTION_INPUT_INVALID");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${EVENT_AAD}${idempotencyKey.toLowerCase()}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function rsvpEncryptionAad(idempotencyKey: string): Buffer {
  return Buffer.from(`${EVENT_AAD}${idempotencyKey.toLowerCase()}`, "utf8");
}
