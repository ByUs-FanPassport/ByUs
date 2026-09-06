import { ExternalNotificationError, type ExternalNotificationJob } from "../external-notification-domain.js";
import type { ExternalNotificationSender } from "../external-notification-ports.js";
import { assertEmailTemplateEnabled, renderNotificationEmail } from "../email-template.js";

export class EmailSender implements ExternalNotificationSender {
  constructor(private readonly config: { url: string; token: string }) {}
  async send(job: ExternalNotificationJob) {
    if (job.channel !== "email") throw new ExternalNotificationError("EMAIL_INVALID_CHANNEL", false);
    assertEmailTemplateEnabled(job.templateKey);
    const link = new URL(job.payload.deepLink, "https://byus.kr");
    if (link.origin !== "https://byus.kr" || link.username || link.password) {
      throw new ExternalNotificationError("EMAIL_INVALID_DEEP_LINK", false);
    }
    link.searchParams.set("locale", job.locale);
    const email = renderNotificationEmail({ ...job.payload, deepLink: link.href, templateKey: job.templateKey, locale: job.locale });
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json", "idempotency-key": job.id },
      body: JSON.stringify({ to: job.destination, template: job.templateKey, locale: job.locale, ...job.payload, title: email.subject, subject: email.subject, detail: email.text, deepLink: link.href, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!response) throw new ExternalNotificationError("EMAIL_NETWORK", true);
    if (response.status === 429 || response.status >= 500) throw new ExternalNotificationError("EMAIL_RETRYABLE", true);
    if (!response.ok) throw new ExternalNotificationError("EMAIL_REJECTED", false);
    const body = await response.json().catch(() => ({})) as { id?: unknown };
    return { providerMessageId: typeof body.id === "string" ? body.id : job.id };
  }
}
