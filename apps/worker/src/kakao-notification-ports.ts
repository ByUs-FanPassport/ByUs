import type { SolapiLookupResult, SolapiPreparedRequest, SolapiSubmitResult } from "./solapi/index.js";
import type { KakaoNotificationJob, KakaoReconciliationJob } from "./kakao-notification-domain.js";

export interface KakaoNotificationQueue {
  maintain(): Promise<void>;
  claim(workerId: string, batchSize: number, leaseSeconds: number): Promise<KakaoNotificationJob[]>;
  begin(job: KakaoNotificationJob, templateId: string, requestHash: string): Promise<boolean>;
  recordSubmission(job: KakaoNotificationJob, result: {
    outcome: "accepted" | "rejected" | "unknown" | "suppressed";
    providerMessageId: string | null;
    groupId: string | null;
    errorCode: string | null;
  }): Promise<void>;
  claimReconciliations(batchSize: number): Promise<KakaoReconciliationJob[]>;
  recordResult(job: KakaoReconciliationJob, result: SolapiLookupResult): Promise<void>;
}

export interface KakaoSolapiClient {
  submitPrepared(request: SolapiPreparedRequest, deliveryKey: string): Promise<SolapiSubmitResult>;
  lookup(expected: {
    providerMessageId: string;
    groupId: string;
    deliveryKey: string;
    destinationFingerprint: string;
    channelId: string;
    templateId: string;
  }): Promise<SolapiLookupResult>;
}
