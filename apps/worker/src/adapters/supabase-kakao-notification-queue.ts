import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KakaoNotificationJob, KakaoReconciliationJob } from "../kakao-notification-domain.js";
import type { KakaoNotificationQueue } from "../kakao-notification-ports.js";
import type { SolapiLookupResult } from "../solapi/index.js";

type Rpc = Pick<SupabaseClient, "rpc">;

function claimed(value: Record<string, unknown>): KakaoNotificationJob {
  return {
    id:String(value.id),
    attemptToken:String(value.attempt_token),
    notificationId:String(value.notification_id),
    templateKey:String(value.template_key),
    locale:String(value.locale),
    destination:String(value.destination),
    payload:value.payload,
    templateId:String(value.template_id),
    leaseExpiresAt:String(value.lease_expires_at),
  };
}

function reconciliation(value: Record<string, unknown>): KakaoReconciliationJob {
  return {
    id:String(value.id),
    providerMessageId:String(value.provider_message_id),
    groupId:String(value.group_id),
    destinationFingerprint:String(value.destination_fingerprint),
    templateId:String(value.template_id),
    status:String(value.status),
  };
}

export class SupabaseKakaoNotificationQueue implements KakaoNotificationQueue {
  constructor(private readonly client: Rpc) {}

  static create(url: string, key: string) {
    return new this(createClient(url, key, {
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    }));
  }

  async maintain() {
    const {error} = await this.client.rpc("maintain_kakao_notification_deliveries");
    if (error) throw new Error("kakao notification maintenance failed");
  }

  async claim(workerId: string, batchSize: number, leaseSeconds: number) {
    const {data,error} = await this.client.rpc("claim_kakao_notification_deliveries", {
      p_worker_id:workerId,p_batch_size:batchSize,p_lease_seconds:leaseSeconds,
    });
    if (error) throw new Error("kakao notification claim failed");
    return ((data ?? []) as Record<string, unknown>[]).map(claimed);
  }

  async begin(job: KakaoNotificationJob, templateId: string, requestHash: string) {
    const {data,error} = await this.client.rpc("begin_kakao_notification_send", {
      p_delivery_id:job.id,
      p_attempt_token:job.attemptToken,
      p_template_id:templateId,
      p_request_hash:requestHash,
    });
    if (error) throw new Error("kakao notification begin failed");
    return data === true;
  }

  async recordSubmission(job: KakaoNotificationJob, result: {
    outcome:"accepted"|"rejected"|"unknown"|"suppressed";
    providerMessageId:string|null;
    groupId:string|null;
    errorCode:string|null;
  }) {
    const {data,error} = await this.client.rpc("record_kakao_notification_submission", {
      p_delivery_id:job.id,
      p_attempt_token:job.attemptToken,
      p_outcome:result.outcome,
      p_provider_message_id:result.providerMessageId,
      p_group_id:result.groupId,
      p_error_code:result.errorCode,
    });
    if (error || data !== true) throw new Error("kakao notification submission acknowledgement failed");
  }

  async claimReconciliations(batchSize: number) {
    const {data,error} = await this.client.rpc("claim_kakao_notification_reconciliations", {
      p_batch_size:batchSize,
    });
    if (error) throw new Error("kakao notification reconciliation claim failed");
    return ((data ?? []) as Record<string, unknown>[]).map(reconciliation);
  }

  async recordResult(job: KakaoReconciliationJob, result: SolapiLookupResult) {
    const {data,error} = await this.client.rpc("record_kakao_notification_result", {
      p_delivery_id:job.id,
      p_provider_message_id:job.providerMessageId,
      p_outcome:result.status,
      p_status_code:result.statusCode,
    });
    if (error || data !== true) throw new Error("kakao notification result acknowledgement failed");
  }
}
