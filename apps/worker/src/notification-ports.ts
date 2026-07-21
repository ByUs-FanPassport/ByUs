import type { NotificationDelivery } from "./notification-domain.js";
export interface NotificationQueue {
  claim(
    workerId: string,
    batchSize: number,
    leaseSeconds: number,
  ): Promise<NotificationDelivery[]>;
  complete(delivery: NotificationDelivery): Promise<void>;
  retry(
    delivery: NotificationDelivery,
    error: { code: string; retryable: boolean; disableSubscription: boolean },
  ): Promise<void>;
}
export interface PushSender {
  send(delivery: NotificationDelivery): Promise<void>;
}
