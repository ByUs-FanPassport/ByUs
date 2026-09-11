import webpush from "web-push";
import {
  NotificationDeliveryError,
  type NotificationDelivery,
} from "../notification-domain.js";
import type { PushSender } from "../notification-ports.js";
import { isTrustedWebPushEndpoint } from "./web-push-endpoint.js";
const copy: Record<NotificationDelivery["locale"], Record<NotificationDelivery["kind"], { title: string; body: string }>> = {
  ko: {
    live_24h: { title: "예약한 LIVE가 내일 시작돼요", body: "예약한 LIVE를 미리 확인해 주세요." },
    live_10m: { title: "예약한 LIVE가 10분 후 시작돼요", body: "곧 LIVE가 시작됩니다." },
    live_reserved: { title: "LIVE 예약이 완료됐어요", body: "예약한 LIVE 알림을 보내드릴게요." },
    live_changed: { title: "LIVE 일정이 변경됐어요", body: "변경된 일정을 확인해 주세요." },
    live_cancelled: { title: "예약한 LIVE가 취소됐어요", body: "취소된 LIVE 일정을 확인해 주세요." },
    survey_reminder: { title: "LIVE 후기를 남겨 주세요", body: "참여한 LIVE 설문이 기다리고 있어요." },
    benefit_available: { title: "새 팬 혜택이 열렸어요", body: "받을 수 있는 혜택을 확인해 보세요." },
    level_up: { title: "팬 레벨이 올랐어요", body: "Passport에서 새로운 팬 레벨을 확인해 보세요." },
    benefit_unlocked: { title: "새 혜택을 받을 수 있어요", body: "팬 활동으로 열린 혜택을 확인해 보세요." },
    benefit_won: { title: "Benefit에 당첨됐어요", body: "MY에서 당첨 결과를 확인해 주세요." },
    recipient_information_required: { title: "수령 정보를 입력해 주세요", body: "Benefit 수령에 필요한 정보를 입력해 주세요." },
    fulfillment_meaningful_update: { title: "Benefit 수령 상태가 변경됐어요", body: "MY에서 현재 수령 상태를 확인해 주세요." },
    collectible_claim_available: { title: "Collectible을 받을 수 있어요", body: "수령 가능한 Collectible을 확인해 주세요." },
    collectible_claim_expiring: { title: "Collectible 수령 기간이 곧 끝나요", body: "기간 안에 Collectible을 수령해 주세요." },
  },
  en: {
    live_24h: { title: "Your reserved LIVE starts tomorrow", body: "Review your reserved LIVE." },
    live_10m: { title: "Your reserved LIVE starts in 10 minutes", body: "Your LIVE is about to begin." },
    live_reserved: { title: "Your LIVE is reserved", body: "We'll remind you about this LIVE." },
    live_changed: { title: "Your LIVE schedule changed", body: "Review the updated schedule." },
    live_cancelled: { title: "Your reserved LIVE was cancelled", body: "Review the cancelled LIVE." },
    survey_reminder: { title: "Tell us about the LIVE", body: "Your LIVE survey is ready." },
    benefit_available: { title: "A new fan benefit is available", body: "See the benefit now." },
    level_up: { title: "Your fan level increased", body: "See your new level in Passport." },
    benefit_unlocked: { title: "You unlocked a new benefit", body: "See the benefit unlocked by your fan activity." },
    benefit_won: { title: "You won a Benefit", body: "Review your reward in MY." },
    recipient_information_required: { title: "Enter recipient information", body: "Provide the information needed to receive your Benefit." },
    fulfillment_meaningful_update: { title: "Your Benefit status changed", body: "Review the current status in MY." },
    collectible_claim_available: { title: "Your Collectible is ready", body: "Review the Collectible available to claim." },
    collectible_claim_expiring: { title: "Your Collectible claim period ends soon", body: "Claim your Collectible before the deadline." },
  },
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
    if (!isTrustedWebPushEndpoint(delivery.endpoint))
      throw new NotificationDeliveryError(
        "INVALID_PUSH_ENDPOINT",
        false,
        true,
      );

    try {
      await webpush.sendNotification(
        {
          endpoint: delivery.endpoint,
          keys: { p256dh: delivery.p256dh, auth: delivery.authSecret },
        },
        JSON.stringify({
          notificationId: delivery.notificationId,
          locale: delivery.locale,
          ...copy[delivery.locale][delivery.kind],
        }),
        {
          TTL: 86400,
          timeout: 10_000,
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
      if (status >= 300)
        throw new NotificationDeliveryError("PUSH_REJECTED", false);
      throw new NotificationDeliveryError("PUSH_NETWORK_ERROR", true);
    }
  }
}
