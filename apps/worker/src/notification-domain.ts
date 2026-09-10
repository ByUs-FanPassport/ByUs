export type NotificationKind =
  | "live_24h"
  | "live_10m"
  | "survey_reminder"
  | "benefit_available"
  | "level_up"
  | "benefit_unlocked"
  | "live_reserved"
  | "live_changed"
  | "live_cancelled"
  | "benefit_won"
  | "recipient_information_required"
  | "fulfillment_meaningful_update"
  | "collectible_claim_available"
  | "collectible_claim_expiring";
export interface NotificationDelivery {
  id: string;
  notificationId: string;
  kind: NotificationKind;
  locale: "ko" | "en";
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
