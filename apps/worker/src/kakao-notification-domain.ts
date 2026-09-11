import type { SolapiPreparedRequest, SolapiSubmitInput } from "./solapi/index.js";

export interface KakaoNotificationJob {
  id: string;
  attemptToken: string;
  notificationId: string;
  templateKey: string;
  locale: string;
  destination: string;
  payload: unknown;
  templateId: string;
  leaseExpiresAt: string;
}

export interface KakaoReconciliationJob {
  id: string;
  providerMessageId: string;
  groupId: string;
  destinationFingerprint: string;
  templateId: string;
  status: string;
}

export interface PreparedKakaoSubmission {
  input: SolapiSubmitInput;
  request: SolapiPreparedRequest;
  requestHash: string;
}
