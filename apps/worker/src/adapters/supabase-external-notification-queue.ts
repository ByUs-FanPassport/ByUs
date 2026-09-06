import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { ExternalNotificationJob } from "../external-notification-domain.js";
import type { ExternalNotificationQueue } from "../external-notification-ports.js";

type Rpc = Pick<SupabaseClient, "rpc">;
function job(value: Record<string, unknown>): ExternalNotificationJob {
  return {
    id: String(value.id), notificationId: String(value.notification_id), planId: String(value.plan_id),
    channel: String(value.channel) as ExternalNotificationJob["channel"],
    sequence: Number(value.sequence) as 1 | 2, templateKey: String(value.template_key),
    locale: String(value.locale) as "ko" | "en", destination: String(value.destination),
    payload: value.payload as ExternalNotificationJob["payload"], attemptCount: Number(value.attempt_count),
    leaseOwner: String(value.lease_owner), leaseExpiresAt: String(value.lease_expires_at),
  };
}
function redact(value: string) {
  if (value.includes("@")) {
    const [, domain] = value.split("@");
    return `***@${domain}`;
  }
  return `***${value.slice(-4)}`;
}
export class SupabaseExternalNotificationQueue implements ExternalNotificationQueue {
  constructor(private readonly client: Rpc, private readonly environment: "dev" | "prod", private readonly emailOnly = false) {}
  static create(url: string, key: string, environment: "dev" | "prod", emailOnly = false) {
    return new this(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }), environment, emailOnly);
  }
  async claim(workerId: string, batchSize: number, leaseSeconds: number) {
    const { data, error } = await this.client.rpc(this.emailOnly ? "claim_email_notification_deliveries" : "claim_external_notification_deliveries", {
      p_worker_id: workerId, p_batch_size: batchSize, p_lease_seconds: leaseSeconds,
    });
    if (error) throw new Error("external notification claim failed");
    return ((data ?? []) as Record<string, unknown>[]).map(job);
  }
  async revalidateEmail(value: ExternalNotificationJob) {
    const { data, error } = await this.client.rpc("revalidate_email_notification_delivery", {
      p_delivery_id: value.id, p_worker_id: value.leaseOwner,
    });
    if (error) throw new Error("email revalidation failed");
    return data === true;
  }
  async complete(value: ExternalNotificationJob, providerMessageId: string) {
    const { data, error } = await this.client.rpc("complete_external_notification_delivery", {
      p_delivery_id: value.id, p_worker_id: value.leaseOwner, p_provider_message_id: providerMessageId,
    });
    if (error || data !== true) throw new Error("external notification lease is stale");
  }
  async fail(value: ExternalNotificationJob, failure: { code: string; retryable: boolean }) {
    const { data, error } = await this.client.rpc("fail_external_notification_delivery", {
      p_delivery_id: value.id, p_worker_id: value.leaseOwner, p_error_code: failure.code, p_retryable: failure.retryable,
    });
    if (error || data !== true) throw new Error("external notification lease is stale");
  }
  async recordSink(value: ExternalNotificationJob, result: "sent" | "permanent_failure" | "retryable_failure") {
    const payloadHash = createHash("sha256").update(JSON.stringify(value.payload)).digest("hex");
    const { error } = await this.client.rpc("record_notification_test_sink", {
      p_delivery_id: value.id, p_environment: this.environment, p_channel: value.channel,
      p_template_key: value.templateKey, p_redacted_destination: redact(value.destination),
      p_payload_hash: payloadHash, p_result: result,
    });
    if (error) throw new Error("notification test sink write failed");
  }
}
