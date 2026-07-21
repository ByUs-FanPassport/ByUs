import webpush from "web-push";
import {
  NotificationDeliveryError,
  type NotificationDelivery,
} from "../notification-domain.js";
import type { PushSender } from "../notification-ports.js";
const title: Record<NotificationDelivery["kind"], string> = {
  live_24h: "예약한 LIVE가 내일 시작돼요",
  live_10m: "예약한 LIVE가 10분 후 시작돼요",
  survey_reminder: "LIVE 후기를 남겨 주세요",
  benefit_available: "새 팬 혜택이 열렸어요",
  level_up: "팬 레벨이 올랐어요",
  benefit_unlocked: "새 혜택을 받을 수 있어요",
};
export class WebPushSender implements PushSender {
  constructor(input: {
    subject: string;
    publicKey: string;
    privateKey: string;
  }) {
    webpush.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  }
  async send(delivery: NotificationDelivery) {
    try {
      await webpush.sendNotification(
        {
          endpoint: delivery.endpoint,
          keys: { p256dh: delivery.p256dh, auth: delivery.authSecret },
        },
        JSON.stringify({
          notificationId: delivery.notificationId,
          title: title[delivery.kind],
          body: "ByUs에서 자세한 내용을 확인해 주세요.",
        }),
        {
          TTL: 86400,
          urgency: delivery.kind === "live_10m" ? "high" : "normal",
          topic: delivery.notificationId.replaceAll("-", "").slice(0, 32),
        },
      );
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number(error.statusCode)
          : 0;
      if (status === 404 || status === 410)
        throw new NotificationDeliveryError(
          "PUSH_SUBSCRIPTION_GONE",
          false,
          true,
        );
      if (status === 429)
        throw new NotificationDeliveryError("PUSH_RATE_LIMITED", true);
      if (status >= 500)
        throw new NotificationDeliveryError("PUSH_PROVIDER_UNAVAILABLE", true);
      if (status >= 400)
        throw new NotificationDeliveryError("PUSH_REJECTED", false);
      throw new NotificationDeliveryError("PUSH_NETWORK_ERROR", true);
    }
  }
}
