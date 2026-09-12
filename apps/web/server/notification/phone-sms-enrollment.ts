import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { notificationChannelSchema } from "../../features/notification/domain/connected-account";
import type { NotificationConnectionRpcClient } from "./connected-account-repository";
import type { PhoneSmsOutcome } from "./phone-sms-provider";

export function normalizeManualKoreanMobile(value: string): string {
  if (value.length > 32 || !/^(?:\+82[ -]?)?[0-9 -]+$/.test(value)) throw new Error("PHONE_SMS_INVALID_PHONE");
  const national = value.replace(/^\+82[ -]?/, "").replace(/[ -]/g, "");
  const phone = value.startsWith("+82") && !national.startsWith("0") ? `0${national}` : national;
  if (!/^010\d{8}$/.test(phone)) throw new Error("PHONE_SMS_INVALID_PHONE");
  return phone;
}
export function phoneCodeDigest(secret: string, owner: string, id: string, code: string): string {
  return createHmac("sha256", secret).update(`v1|${id}|${owner}|${code}`).digest("hex");
}
export function phoneRateKey(secret: string, phone: string): string {
  return createHmac("sha256", secret).update(`phone-rate-v1|${phone}`).digest("hex");
}
const challengeSchema = z.object({ challengeId: z.uuid(), destinationLabel: z.string().max(32), expiresAt: z.string(), resendAt: z.string(), status: z.string(), created: z.boolean() });
export type PhoneSmsChallenge = z.infer<typeof challengeSchema>;
export class PhoneSmsError extends Error { constructor(readonly code: string) { super(code); } }
export class PhoneSmsEnrollmentRepository {
  constructor(private readonly client: NotificationConnectionRpcClient) {}
  private async call(name: string, params: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, params);
    if (error) {
      const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
      const code = /\bPHONE_SMS_[A-Z0-9_]+\b/.exec(message)?.[0];
      throw new PhoneSmsError(code ?? "PHONE_SMS_UNAVAILABLE");
    }
    return data;
  }
  async reserve(input: { owner: string; id: string; requestId: string; phone: string; rateKey: string; digest: string }) {
    return challengeSchema.parse(await this.call("reserve_owned_phone_sms_challenge", { p_app_user_id: input.owner, p_challenge_id: input.id,
      p_request_id: input.requestId, p_phone: input.phone, p_phone_rate_key: input.rateKey, p_otp_digest: input.digest }));
  }
  async begin(owner: string, id: string) { return (await this.call("begin_phone_sms_send", { p_app_user_id: owner, p_challenge_id: id })) === true; }
  async finish(owner: string, id: string, outcome: PhoneSmsOutcome) {
    return (await this.call("finish_phone_sms_send", { p_app_user_id: owner, p_challenge_id: id, p_outcome: outcome.status,
      p_provider_message_id: outcome.status === "accepted" ? outcome.providerMessageId : null,
      p_provider_group_id: outcome.status === "accepted" ? outcome.providerGroupId : null })) === true;
  }
  async verify(owner: string, id: string, digest: string) {
    return z.object({ verified: z.boolean(), error: z.string().nullable().optional() }).parse(await this.call("verify_owned_phone_sms_challenge", {
      p_app_user_id: owner, p_challenge_id: id, p_candidate_digest: digest }));
  }
  async confirm(owner: string, id: string, consentVersion: string) {
    return notificationChannelSchema.parse(await this.call("confirm_owned_phone_sms_enrollment", { p_app_user_id: owner, p_challenge_id: id, p_consent_version: consentVersion }));
  }
  async cancel(owner: string, id: string) { return (await this.call("cancel_owned_phone_sms_challenge", { p_app_user_id: owner, p_challenge_id: id })) === true; }
}
