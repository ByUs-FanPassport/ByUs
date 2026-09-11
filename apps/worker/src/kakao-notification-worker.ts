import { createHash } from "node:crypto";
import type { KakaoNotificationJob } from "./kakao-notification-domain.js";
import type { KakaoNotificationQueue, KakaoSolapiClient } from "./kakao-notification-ports.js";
import {
  buildSolapiRequest,
  SOLAPI_APPROVED_TEMPLATES,
  SOLAPI_CHANNEL_ID,
  SolapiValidationError,
  type SolapiSubmitInput,
  type SolapiSubmitResult,
} from "./solapi/index.js";

const MAX_KAKAO_BATCH = 2;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function mapToSolapiSubmitInput(job: KakaoNotificationJob): SolapiSubmitInput {
  const payload = object(job.payload);
  const context = object(payload?.context);
  const base = {
    id:job.id,
    channel:"kakao" as const,
    locale:job.locale,
    destination:job.destination,
    templateKey:job.templateKey,
    context:{artist:context?.artist,title:context?.title},
    deepLink:payload?.deepLink,
  };
  if (job.templateKey === "fulfillment_meaningful_update") {
    return {
      ...base,
      locale:base.locale as "ko",
      templateKey:job.templateKey,
      context:{...base.context,fulfillmentStatus:context?.fulfillmentStatus},
    } as SolapiSubmitInput;
  }
  if (["live_reserved","live_24h","live_10m","live_changed"].includes(job.templateKey)) {
    return {...base,locale:base.locale as "ko",startsAt:context?.startsAt} as SolapiSubmitInput;
  }
  return {...base,locale:base.locale as "ko"} as SolapiSubmitInput;
}

function submissionRecord(result: SolapiSubmitResult) {
  if (result.status === "accepted") return {
    outcome:"accepted" as const,
    providerMessageId:result.receipt.providerMessageId,
    groupId:result.receipt.groupId,
    errorCode:null,
  };
  return {
    outcome:result.status,
    providerMessageId:null,
    groupId:null,
    errorCode:result.code,
  };
}

export class KakaoNotificationWorker {
  constructor(
    private readonly queue: KakaoNotificationQueue,
    private readonly client: KakaoSolapiClient,
    private readonly options: {workerId:string;leaseSeconds:number},
  ) {}

  private async reconcile() {
    const jobs = await this.queue.claimReconciliations(MAX_KAKAO_BATCH);
    for (const job of jobs) {
      let result;
      try {
        result = await this.client.lookup({
          providerMessageId:job.providerMessageId,
          groupId:job.groupId,
          deliveryKey:job.id,
          destinationFingerprint:job.destinationFingerprint,
          channelId:SOLAPI_CHANNEL_ID,
          templateId:job.templateId,
        });
      } catch {
        result = {status:"unknown" as const,statusCode:null};
      }
      await this.queue.recordResult(job, result);
    }
    return jobs.length;
  }

  private async send() {
    const jobs = await this.queue.claim(this.options.workerId, MAX_KAKAO_BATCH, this.options.leaseSeconds);
    for (const job of jobs) {
      let input: SolapiSubmitInput;
      let request;
      try {
        input = mapToSolapiSubmitInput(job);
        request = buildSolapiRequest(input, SOLAPI_APPROVED_TEMPLATES);
        if (request.messages[0].kakaoOptions.templateId !== job.templateId) {
          throw new SolapiValidationError("SOLAPI_TEMPLATE_SNAPSHOT_MISMATCH");
        }
      } catch (error) {
        await this.queue.recordSubmission(job, {
          outcome:"suppressed",
          providerMessageId:null,
          groupId:null,
          errorCode:error instanceof SolapiValidationError ? error.code : "SOLAPI_INVALID_CLAIM_PAYLOAD",
        });
        continue;
      }
      const requestHash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
      if (!await this.queue.begin(job, job.templateId, requestHash)) continue;

      let result: SolapiSubmitResult;
      try {
        result = await this.client.submitPrepared(request, job.id);
      } catch {
        result = {
          status:"unknown",
          code:"SOLAPI_NETWORK_UNKNOWN",
          reconciliation:"DO_NOT_RESEND_OR_FALL_BACK_PENDING_MANUAL_RECONCILIATION",
        };
      }
      // This acknowledgement deliberately sits outside the provider catch. A
      // failed DB write must surface without entering any resend path.
      await this.queue.recordSubmission(job, submissionRecord(result));
    }
    return jobs.length;
  }

  async runOnce() {
    await this.queue.maintain();
    const reconciled = await this.reconcile();
    return reconciled + await this.send();
  }
}
