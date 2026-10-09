import { assertEmailTemplateEnabled } from "./email-template.js";
import { ExternalNotificationError } from "./external-notification-domain.js";
import type { ExternalNotificationQueue, ExternalSenders } from "./external-notification-ports.js";

export class ExternalNotificationWorker {
  constructor(
    private readonly queue: ExternalNotificationQueue,
    private readonly senders: ExternalSenders,
    private readonly options: {
      workerId: string;
      batchSize: number;
      leaseSeconds: number;
      remainingTimeInMillis?: () => number;
    },
  ) {}

  async runOnce() {
    const jobs = await this.queue.claim(this.options.workerId, this.options.batchSize, this.options.leaseSeconds);
    let lastEmailSendAt = 0;
    for (const job of jobs) {
      if (Date.parse(job.leaseExpiresAt) <= Date.now()) continue;
      if (job.channel === "email") {
        if ((this.options.remainingTimeInMillis?.() ?? Infinity) < 30_000
          || Date.parse(job.leaseExpiresAt) - Date.now() < 30_000) break;
        try {
          assertEmailTemplateEnabled(job.templateKey);
          if (!await this.queue.revalidateEmail(job)) continue;
        } catch (error) {
          const failure = error instanceof ExternalNotificationError
            ? error : new ExternalNotificationError("EXTERNAL_UNEXPECTED", true);
          await this.queue.fail(job, { code: failure.code, retryable: failure.retryable });
          continue;
        }
        const waitMs = lastEmailSendAt + 200 - Date.now();
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        if ((this.options.remainingTimeInMillis?.() ?? Infinity) < 30_000
          || Date.parse(job.leaseExpiresAt) - Date.now() < 30_000) break;
        // A lost begin response grants no permission to send. The durable
        // delivery gate, rather than an expiring lease, authorizes one call.
        if (!await this.queue.beginEmail(job)) continue;
        let result;
        try {
          lastEmailSendAt = Date.now();
          result = await this.senders.email.send(job);
        } catch {
          // Provider retryability is not evidence that no email was accepted.
          await this.queue.finishEmail(job, {
            outcome: "unknown", providerMessageId: null, errorCode: "EMAIL_SEND_OUTCOME_UNKNOWN",
          });
          continue;
        }
        // A failed acknowledgement must never enter the provider failure path.
        await this.queue.finishEmail(job, {
          outcome: "accepted", providerMessageId: result.providerMessageId, errorCode: null,
        });
        continue;
      }
      try {
        const result = await this.senders[job.channel].send(job);
        await this.queue.complete(job, result.providerMessageId);
      } catch (error) {
        const failure = error instanceof ExternalNotificationError
          ? error
          : new ExternalNotificationError("EXTERNAL_UNEXPECTED", true);
        await this.queue.fail(job, { code: failure.code, retryable: failure.retryable });
      }
    }
    return jobs.length;
  }
}
