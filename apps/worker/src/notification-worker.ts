import { NotificationDeliveryError } from "./notification-domain.js";
import type { NotificationQueue, PushSender } from "./notification-ports.js";
export class NotificationWorker {
  constructor(
    private readonly queue: NotificationQueue,
    private readonly sender: PushSender,
    private readonly options: {
      workerId: string;
      batchSize: number;
      leaseSeconds: number;
    },
  ) {}
  async runOnce() {
    const deliveries = await this.queue.claim(
      this.options.workerId,
      this.options.batchSize,
      this.options.leaseSeconds,
    );
    for (const delivery of deliveries) {
      if (Date.parse(delivery.leaseExpiresAt) <= Date.now()) continue;
      try {
        await this.sender.send(delivery);
        await this.queue.complete(delivery);
      } catch (error) {
        const failure =
          error instanceof NotificationDeliveryError
            ? error
            : new NotificationDeliveryError("UNEXPECTED_PUSH_ERROR", true);
        await this.queue.retry(delivery, {
          code: failure.code,
          retryable: failure.retryable,
          disableSubscription: failure.disableSubscription,
        });
      }
    }
    return deliveries.length;
  }
}
