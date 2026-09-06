import { assertEmailTemplateEnabled, renderNotificationEmail } from "../email-template.js";
import { emailInlineAssets } from "../email-inline-assets.js";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import {
  ExternalNotificationError,
  type ExternalNotificationJob,
} from "../external-notification-domain.js";
import type { ExternalNotificationSender } from "../external-notification-ports.js";

export interface SesV2SendClient {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export interface SesEmailSenderConfig {
  region: string;
  fromEmail: string;
  trustedOrigin?: string;
  client?: SesV2SendClient;
  storageOrigin?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_TRUSTED_ORIGIN = "https://byus.kr";
const RETRYABLE_ERROR_NAMES = new Set([
  "InternalFailure",
  "InternalServerError",
  "LimitExceededException",
  "RequestTimeout",
  "RequestTimeoutException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
]);
const PERMANENT_ERROR_NAMES = new Set([
  "AccessDeniedException",
  "AccountSuspendedException",
  "BadRequestException",
  "MailFromDomainNotVerifiedException",
  "MessageRejected",
  "NotFoundException",
]);

function isEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    !value.includes("\r") &&
    !value.includes("\n") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function trustedOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("invalid trusted origin");
    }
    return url.origin;
  } catch {
    throw new ExternalNotificationError("EMAIL_INVALID_CONFIG", false);
  }
}

function resolveDeepLink(value: string, origin: string): string {
  try {
    if (!value.trim() || value.startsWith("//")) {
      throw new Error("protocol-relative URL is not trusted");
    }
    const url = new URL(value, `${origin}/`);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
      throw new Error("URL is outside the trusted origin");
    }
    return url.href;
  } catch {
    throw new ExternalNotificationError("EMAIL_INVALID_DEEP_LINK", false);
  }
}

function isRetryableAwsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const value = error as {
    name?: unknown;
    $fault?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    $retryable?: unknown;
  };
  if (typeof value.name === "string" && RETRYABLE_ERROR_NAMES.has(value.name)) return true;
  if (typeof value.name === "string" && PERMANENT_ERROR_NAMES.has(value.name)) return false;
  if (value.$retryable) return true;
  if (typeof value.$metadata?.httpStatusCode === "number") {
    return value.$metadata.httpStatusCode === 429 || value.$metadata.httpStatusCode >= 500;
  }
  return value.$fault !== "client";
}

export class SesEmailSender implements ExternalNotificationSender {
  private readonly client: SesV2SendClient;
  private readonly origin: string;

  constructor(private readonly config: SesEmailSenderConfig) {
    if (!config.region.trim() || !isEmail(config.fromEmail)) {
      throw new ExternalNotificationError("EMAIL_INVALID_CONFIG", false);
    }
    this.origin = trustedOrigin(config.trustedOrigin ?? DEFAULT_TRUSTED_ORIGIN);
    this.client =
      config.client ??
      new SESv2Client({
        region: config.region,
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 2_000, requestTimeout: 8_000, throwOnRequestTimeout: true },
      });
  }

  async send(job: ExternalNotificationJob): Promise<{ providerMessageId: string }> {
    if (job.channel !== "email") {
      throw new ExternalNotificationError("EMAIL_INVALID_CHANNEL", false);
    }
    assertEmailTemplateEnabled(job.templateKey);
    if (!isEmail(job.destination)) {
      throw new ExternalNotificationError("EMAIL_INVALID_DESTINATION", false);
    }
    const localizedLink = new URL(resolveDeepLink(job.payload.deepLink, this.origin));
    localizedLink.searchParams.set("locale", job.locale);
    const deepLink = localizedLink.href;

    const context = job.payload.context;
    let imageUrl: string | undefined;
    if (typeof context?.imageUrl === "string") {
      try {
        const image = new URL(context.imageUrl, `${this.origin}/`);
        if (image.protocol === "https:" && !image.username && !image.password && !context.imageUrl.startsWith("//")) imageUrl = image.href;
      } catch { /* An absent or invalid poster must not block the notification. */ }
    }
    const assets = await emailInlineAssets(imageUrl, {
      origin: this.origin,
      storageOrigin: this.config.storageOrigin,
      fetcher: this.config.fetcher,
    });
    const email = renderNotificationEmail({
      title: job.payload.title, detail: job.payload.detail, deepLink,
      locale: job.locale, templateKey: job.templateKey,
      inlineAssets: { logoContentId: "byus-logo", ...(assets.posterContentId ? { posterContentId: assets.posterContentId } : {}) },
      ...(context ? { context: { ...context, imageUrl: undefined } } : {}),
    });

    let response: { MessageId?: string };
    try {
      // SES v2 SendEmail has no idempotency token. The queue lease limits concurrent
      // sends, but a retry after an ambiguous provider response can still duplicate mail.
      response = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.config.fromEmail,
          Destination: { ToAddresses: [job.destination] },
          Content: {
            Simple: {
              Attachments: assets.attachments,
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: email.html, Charset: "UTF-8" },
                Text: {
                  Data: email.text,
                  Charset: "UTF-8",
                },
              },
            },
          },
        }),
      );
    } catch (error) {
      if (isRetryableAwsError(error)) {
        throw new ExternalNotificationError("EMAIL_RETRYABLE", true);
      }
      throw new ExternalNotificationError("EMAIL_REJECTED", false);
    }

    if (!response.MessageId) {
      throw new ExternalNotificationError("EMAIL_INVALID_RESPONSE", false);
    }
    return { providerMessageId: response.MessageId };
  }
}
