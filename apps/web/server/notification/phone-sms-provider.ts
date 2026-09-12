import "server-only";
import { createHmac, randomBytes } from "node:crypto";

export type PhoneSmsOutcome = { status: "accepted"; providerMessageId: string; providerGroupId: string } | { status: "rejected" | "unknown" };
export interface PhoneSmsProvider {
  send(input: { phone: string; code: string; challengeId: string }): Promise<PhoneSmsOutcome>;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{2,128}$/.test(value);

/** Single HTTP attempt only. The caller must win the durable DB send CAS first. */
export class SolapiPhoneSmsProvider implements PhoneSmsProvider {
  constructor(private readonly config: { apiKey: string; apiSecret: string; sender: string; fetch?: typeof fetch }) {}
  async send(input: { phone: string; code: string; challengeId: string }): Promise<PhoneSmsOutcome> {
    if (!/^010\d{8}$/.test(input.phone) || !/^\d{6}$/.test(input.code) || !/^[a-f0-9-]{36}$/i.test(input.challengeId)
      || !/^\d{8,12}$/.test(this.config.sender) || !/^[A-Za-z0-9_-]{8,256}$/.test(this.config.apiKey)
      || !/^[\x21-\x7e]{8,256}$/.test(this.config.apiSecret)) return { status: "rejected" };
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", this.config.apiSecret).update(date + salt).digest("hex");
    try {
      const response = await (this.config.fetch ?? fetch)("https://api.solapi.com/messages/v4/send-many/detail", {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
        headers: { "content-type": "application/json", authorization: `HMAC-SHA256 apiKey=${this.config.apiKey}, date=${date}, salt=${salt}, signature=${signature}` },
        body: JSON.stringify({ messages: [{ to: input.phone, from: this.config.sender, type: "SMS", country: "82", autoTypeDetect: false,
          text: `[ByUs] 인증번호 ${input.code} (5분 이내 입력)`, customFields: { challengeId: input.challengeId } }], showMessageList: true }),
      });
      if (response.status >= 500 || response.status === 429) return { status: "unknown" };
      const data = object(await response.json());
      const group = object(data.groupInfo); const count = object(group.count);
      const messages = Array.isArray(data.messageList) ? data.messageList : [];
      const failed = Array.isArray(data.failedMessageList) ? data.failedMessageList : [];
      const first = object(messages[0]);
      if (response.ok && count.total === 1 && count.registeredSuccess === 1 && count.registeredFailed === 0
        && messages.length === 1 && failed.length === 0 && first.statusCode === "2000"
        && object(first.customFields).challengeId === input.challengeId && safeId(first.messageId) && safeId(group.groupId)) {
        return { status: "accepted", providerMessageId: first.messageId, providerGroupId: group.groupId };
      }
      if (count.total === 1 && count.registeredSuccess === 0 && count.registeredFailed === 1 && failed.length === 1 && messages.length === 0
        && object(object(failed[0]).customFields).challengeId === input.challengeId) return { status: "rejected" };
      return { status: "unknown" };
    } catch { return { status: "unknown" }; }
  }
}
