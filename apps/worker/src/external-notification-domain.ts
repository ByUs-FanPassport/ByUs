import type { NotificationEmailContext } from "./email-template.js";

export type ExternalChannel = "email" | "kakao";
export interface ExternalNotificationJob {
  id: string;
  notificationId: string;
  planId: string;
  channel: ExternalChannel;
  sequence: 1 | 2;
  templateKey: string;
  locale: "ko" | "en";
  destination: string;
  payload: {
    title: string;
    detail: string;
    deepLink: string;
    context?: NotificationEmailContext;
  };
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}
export class ExternalNotificationError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "ExternalNotificationError";
  }
}
