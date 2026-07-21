export type NotificationKind =
  | "live_24h"
  | "live_10m"
  | "survey_reminder"
  | "benefit_available"
  | "level_up"
  | "benefit_unlocked";
export interface NotificationDelivery {
  id: string;
  notificationId: string;
  kind: NotificationKind;
  endpoint: string;
  p256dh: string;
  authSecret: string;
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}
export class NotificationDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly disableSubscription = false,
  ) {
    super(code);
    this.name = "NotificationDeliveryError";
  }
}
