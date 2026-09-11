import { createClient } from "@supabase/supabase-js";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { NotificationWorkerEnv } from "./notification-env.js";

export interface BusinessInquiry {
  id: string; attempt_token: string; locale: "ko" | "en";
  inquiry_type?: "fanmeeting" | "creator" | "partner";
  contact_name: string; company: string; email: string; message: string;
}
export type InquiryOutcome = "sent" | "throttled" | "rejected" | "unknown";
export interface InquiryQueue {
  maintain(): Promise<void>;
  claim(): Promise<BusinessInquiry | null>;
  begin(job: BusinessInquiry): Promise<boolean>;
  finish(job: BusinessInquiry, outcome: InquiryOutcome, providerId?: string): Promise<void>;
}
export interface InquirySender { send(job: BusinessInquiry): Promise<string> }
export class InquirySendError extends Error {
  constructor(readonly outcome: Exclude<InquiryOutcome, "sent">) { super(`INQUIRY_${outcome.toUpperCase()}`); }
}
export class BusinessInquiryWorker {
  constructor(private readonly queue: InquiryQueue, private readonly sender: InquirySender | null) {}
  async runOnce(): Promise<number> {
    await this.queue.maintain();
    if (!this.sender) return 0;
    const job = await this.queue.claim();
    if (!job) return 0;
    // If begin's response is lost, do not send. An expired durable sending state
    // becomes unknown; unlike an expired claimed lease it is never sent again.
    if (!await this.queue.begin(job)) return 0;
    let providerId: string;
    try { providerId = await this.sender.send(job); }
    catch (error) {
      await this.queue.finish(job, error instanceof InquirySendError ? error.outcome : "unknown");
      return 0;
    }
    // Ack errors MUST NOT pass through the send-error/retry branch.
    await this.queue.finish(job, "sent", providerId);
    return 1;
  }
}

type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export class SupabaseInquiryQueue implements InquiryQueue {
  constructor(private readonly db: Rpc) {}
  private async call(name: string, args?: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error("BUSINESS_INQUIRY_QUEUE_UNAVAILABLE");
    return data;
  }
  async maintain() { await this.call("maintain_business_inquiries"); }
  async claim() {
    const data = await this.call("claim_business_inquiry");
    if (!Array.isArray(data) || data.length > 1) throw new Error("BUSINESS_INQUIRY_INVALID_JOB");
    if (!data.length) return null;
    const row = data[0] as Record<string, unknown>;
    if (!["id", "attempt_token", "contact_name", "company", "email", "message"].every((key) => typeof row[key] === "string") || !["ko", "en"].includes(String(row.locale))) throw new Error("BUSINESS_INQUIRY_INVALID_JOB");
    const inquiryType = row.inquiry_type ?? "fanmeeting";
    if (!["fanmeeting", "creator", "partner"].includes(String(inquiryType))) throw new Error("BUSINESS_INQUIRY_INVALID_JOB");
    return { ...row, inquiry_type: inquiryType } as unknown as BusinessInquiry;
  }
  async begin(job: BusinessInquiry) {
    return await this.call("begin_business_inquiry_send", { p_id: job.id, p_token: job.attempt_token }) === true;
  }
  async finish(job: BusinessInquiry, outcome: InquiryOutcome, providerId?: string) {
    if (await this.call("finish_business_inquiry", { p_id: job.id, p_token: job.attempt_token, p_outcome: outcome, p_provider_id: providerId ?? null }) !== true) throw new Error("BUSINESS_INQUIRY_STALE_ATTEMPT");
  }
}

interface SesClient { send(command: SendEmailCommand): Promise<{ MessageId?: string }> }
export class SesInquirySender implements InquirySender {
  constructor(private readonly client: SesClient = new SESv2Client({
    region: "ap-northeast-2", maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 8000, throwOnRequestTimeout: true },
  })) {}
  async send(job: BusinessInquiry) {
    if (job.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.email) || /[\r\n]/.test(job.email)) throw new InquirySendError("rejected");
    const inquiryType = job.inquiry_type ?? "fanmeeting";
    const label = {
      fanmeeting: "미국 팬미팅 문의",
      creator: "ByUs 시작 문의",
      partner: "파트너 문의",
    }[inquiryType];
    if (!label) throw new InquirySendError("rejected");
    let result: { MessageId?: string };
    try {
      result = await this.client.send(new SendEmailCommand({
        FromEmailAddress: "notifications@byus.kr",
        Destination: { ToAddresses: ["biz@sallylab.io"], CcAddresses: ["jongho@sallylab.io", "jaeyeong@sallylab.io"] },
        ReplyToAddresses: [job.email],
        Content: { Simple: {
          Subject: { Data: `[ByUs] ${label} · ${job.id}`, Charset: "UTF-8" },
          Body: { Text: { Charset: "UTF-8", Data: [
            `ByUs ${label}`, `문의 번호: ${job.id}`, `언어: ${job.locale}`,
            `담당자: ${job.contact_name}`, `회사: ${job.company}`, `회신 이메일: ${job.email}`,
            "", "문의 내용", job.message,
          ].join("\n") } },
        } },
      }));
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      // Only explicit SES throttling is known not to have accepted the email.
      if (["TooManyRequestsException", "ThrottlingException", "Throttling"].includes(name)) throw new InquirySendError("throttled");
      if (["AccessDeniedException", "AccountSuspendedException", "BadRequestException", "MailFromDomainNotVerifiedException", "MessageRejected", "NotFoundException"].includes(name)) throw new InquirySendError("rejected");
      throw new InquirySendError("unknown");
    }
    if (!result.MessageId) throw new InquirySendError("unknown");
    return result.MessageId;
  }
}
export async function runBusinessInquiryOnce(env: NotificationWorkerEnv) {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  });
  const sender = env.BUSINESS_INQUIRY_MODE === "ses_email" ? new SesInquirySender() : null;
  return new BusinessInquiryWorker(new SupabaseInquiryQueue(db), sender).runOnce();
}
