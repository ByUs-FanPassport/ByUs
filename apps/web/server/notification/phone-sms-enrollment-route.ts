import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import { KAKAO_ALIMTALK_CONSENT_VERSION } from "./kakao-phone-enrollment";
import { normalizeManualKoreanMobile, phoneCodeDigest, phoneRateKey, PhoneSmsError, type PhoneSmsEnrollmentRepository } from "./phone-sms-enrollment";
import type { PhoneSmsProvider } from "./phone-sms-provider";

export interface PhoneSmsDependencies {
  enabled: boolean; origin: string; otpSecret: string;
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: Pick<PhoneSmsEnrollmentRepository, "reserve" | "begin" | "finish" | "verify" | "confirm" | "cancel">;
  provider: PhoneSmsProvider;
}
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const requestSchema = z.object({ phone: z.string().max(32), requestId: z.uuid() }).strict();
const verifySchema = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict();
const confirmSchema = z.object({ challengeId: z.uuid(), consented: z.literal(true), consentVersion: z.literal(KAKAO_ALIMTALK_CONSENT_VERSION) }).strict();
const cancelSchema = z.object({ challengeId: z.uuid() }).strict();
async function read<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new PhoneSmsError("PHONE_SMS_INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new PhoneSmsError("PHONE_SMS_INVALID_REQUEST");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) { await reader.cancel(); throw new PhoneSmsError("PHONE_SMS_INVALID_REQUEST"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  try { return schema.parse(JSON.parse(raw)); } catch { throw new PhoneSmsError("PHONE_SMS_INVALID_REQUEST"); }
}
export function createPhoneSmsHandler(action: "request" | "verify" | "confirm" | "cancel", deps: PhoneSmsDependencies) {
  return async (request: Request) => {
    if (!deps.enabled) return json({ error: { code: "PHONE_SMS_UNAVAILABLE" } }, 503);
    try {
      if (request.method !== "POST" || request.headers.get("origin") !== deps.origin || new URL(request.url).origin !== deps.origin
        || request.headers.get("sec-fetch-site") === "cross-site") throw new PhoneSmsError("PHONE_SMS_INVALID_REQUEST");
      const { appUserId: owner } = await deps.authorize(request.headers.get("authorization") ?? "");
      if (action === "request") {
        const body = await read(request, requestSchema);
        let phone: string;
        try { phone = normalizeManualKoreanMobile(body.phone); } catch { throw new PhoneSmsError("PHONE_SMS_INVALID_PHONE"); }
        const id = randomUUID(); const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        const challenge = await deps.repository.reserve({ owner, id, requestId: body.requestId, phone,
          rateKey: phoneRateKey(deps.otpSecret, phone), digest: phoneCodeDigest(deps.otpSecret, owner, id, code) });
        let status = challenge.status;
        if (challenge.created && await deps.repository.begin(owner, challenge.challengeId)) {
          // Neither ambiguous provider responses nor an ACK write failure permit another send.
          const outcome = await deps.provider.send({ phone, code, challengeId: challenge.challengeId }).catch(() => ({ status: "unknown" as const }));
          status = outcome.status;
          try { if (!await deps.repository.finish(owner, challenge.challengeId, outcome)) status = "unknown"; } catch { status = "unknown"; }
        }
        return json({ challenge: { challengeId: challenge.challengeId, destinationLabel: challenge.destinationLabel,
          expiresAt: challenge.expiresAt, resendAt: challenge.resendAt, status } });
      }
      if (action === "verify") {
        const body = await read(request, verifySchema);
        const result = await deps.repository.verify(owner, body.challengeId, phoneCodeDigest(deps.otpSecret, owner, body.challengeId, body.code));
        if (!result.verified) throw new PhoneSmsError(result.error ?? "PHONE_SMS_INVALID_CODE");
        return json({ verified: true });
      }
      if (action === "confirm") {
        const body = await read(request, confirmSchema);
        return json({ channel: await deps.repository.confirm(owner, body.challengeId, body.consentVersion) });
      }
      const body = await read(request, cancelSchema);
      await deps.repository.cancel(owner, body.challengeId);
      return new Response(null, { status: 204, headers });
    } catch (error) {
      if (error instanceof AuthError) return json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
      const code = error instanceof PhoneSmsError ? error.code : "PHONE_SMS_UNAVAILABLE";
      return json({ error: { code } }, /RATE|LIMIT|COOLDOWN/.test(code) ? 429 : code === "PHONE_SMS_UNAVAILABLE" ? 503 : 400);
    }
  };
}
