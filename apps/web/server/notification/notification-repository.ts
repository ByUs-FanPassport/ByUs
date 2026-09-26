import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  NotificationItem,
  NotificationPreferences,
} from "../../features/notification/domain/notification-model";

type Db = Pick<SupabaseClient, "from" | "rpc">;
type Row = Record<string, unknown>;
export interface NotificationRepository {
  list(input: {
    appUserId: string;
    locale: "ko" | "en";
    recipientLinks?: boolean;
  }): Promise<NotificationItem[]>;
  markRead(input: {
    appUserId: string;
    notificationId: string;
  }): Promise<boolean>;
  markAllRead(appUserId: string): Promise<void>;
  putSubscription(input: {
    appUserId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<void>;
  deleteSubscription(input: {
    appUserId: string;
    endpoint: string;
  }): Promise<void>;
  getPreferences(appUserId: string): Promise<NotificationPreferences>;
  patchPreferences(input: {
    appUserId: string;
    liveReminders?: boolean;
    surveyReminders?: boolean;
    benefitNotifications?: boolean;
    replyNotifications?: boolean;
    officialPostNotifications?: boolean;
    scheduleNotifications?: boolean;
  }): Promise<NotificationPreferences>;
  enqueueDue(now: string): Promise<number>;
}
export class NotificationSubscriptionBusyError extends Error {
  constructor() {
    super("Push subscription transfer is busy");
    this.name = "NotificationSubscriptionBusyError";
  }
}

function one(value: unknown): Row | null {
  return Array.isArray(value)
    ? ((value[0] as Row | undefined) ?? null)
    : value && typeof value === "object"
      ? (value as Row)
      : null;
}
function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
export function projectNotificationRow(
  row: Row,
  locale: "ko" | "en",
  recipientLinks = false,
): NotificationItem {
  const kind = String(row.kind) as NotificationItem["kind"];
  const webCopy = {
    content_reply: ["새 댓글이 도착했어요", "내 글에 남겨진 댓글을 확인해 주세요.", "New comment", "View the comment on your conversation."],
    official_post: ["공식 소식이 도착했어요", "최애의 새로운 소식을 확인해 주세요.", "New official update", "Read the latest update from your favorite."],
    schedule_reminder: ["다가오는 일정이 있어요", "알림을 신청한 일정을 확인해 주세요.", "An event is coming up", "View the event you subscribed to."],
    schedule_changed: ["일정이 변경됐어요", "변경된 시간과 참여 방법을 확인해 주세요.", "Event updated", "Check the updated time and participation details."],
    schedule_cancelled: ["일정이 취소됐어요", "알림을 신청한 일정의 취소 안내를 확인해 주세요.", "Event cancelled", "View the cancellation of your subscribed event."],
    schedule_suggestion_reviewed: ["일정 제안 검토가 끝났어요", "내 요청에서 결과를 확인해 주세요.", "Schedule suggestion reviewed", "View the result in your requests."],
    fanpage_request_reviewed: ["최애 개설 요청 검토가 끝났어요", "내 요청에서 결과를 확인해 주세요.", "Fan page request reviewed", "View the result in your requests."],
  } as const;
  if (kind in webCopy) {
    const copy = webCopy[kind as keyof typeof webCopy];
    return { id: String(row.id), kind, title: copy[locale === "ko" ? 0 : 2], detail: copy[locale === "ko" ? 1 : 3], createdAt: String(row.created_at), readAt: row.read_at == null ? null : String(row.read_at), deepLink: String(row.deep_link) };
  }
  const live = one(row.live_events);
  const benefit = one(row.benefits);
  const liveLoc =
    (Array.isArray(live?.live_event_localizations)
      ? live.live_event_localizations
      : ([] as unknown[])
    )
      .map(one)
      .find((v) => v?.locale === locale) ?? null;
  const benefitLoc =
    (Array.isArray(benefit?.benefit_localizations)
      ? benefit.benefit_localizations
      : ([] as unknown[])
    )
      .map(one)
      .find((v) => v?.locale === locale) ?? null;
  const payload = one(row.payload) ?? {};
  const storedDeepLink =
    typeof row.deep_link === "string" ? row.deep_link : null;
  const liveTitle = text(liveLoc?.title, locale === "ko" ? "라이브" : "LIVE");
  const benefitTitle = text(
    benefitLoc?.title,
    locale === "ko" ? "새 혜택" : "New benefit",
  );
  const fulfillmentStatus = text(payload.fulfillmentStatus, "");
  const fulfillmentLabel = ({
    ko: { information_required: "정보 입력 필요", ready: "준비 완료", shipping_preparing: "배송 준비 중", shipping_in_transit: "배송 중", shipping_completed: "배송 완료", pickup_available: "수령 가능", pickup_completed: "수령 완료", digital_delivered: "지급 완료" },
    en: { information_required: "Information required", ready: "Ready", shipping_preparing: "Preparing shipment", shipping_in_transit: "In transit", shipping_completed: "Delivered", pickup_available: "Ready for pickup", pickup_completed: "Picked up", digital_delivered: "Delivered" },
  } as const)[locale][fulfillmentStatus as "information_required" | "ready" | "shipping_preparing" | "shipping_in_transit" | "shipping_completed" | "pickup_available" | "pickup_completed" | "digital_delivered"];
  const copy = kind === "live_reserved"
      ? [locale === "ko" ? `${liveTitle} 예약이 완료됐어요` : `${liveTitle} is reserved`, locale === "ko" ? "예약한 LIVE 알림을 보내드릴게요." : "We'll remind you about this LIVE."]
      : kind === "live_changed"
        ? [locale === "ko" ? `${liveTitle} 일정이 변경됐어요` : `${liveTitle} schedule changed`, locale === "ko" ? "변경된 일정을 확인해 주세요." : "Review the updated schedule."]
        : kind === "live_cancelled"
          ? [locale === "ko" ? `${liveTitle}가 취소됐어요` : `${liveTitle} was cancelled`, locale === "ko" ? "예약한 LIVE가 취소되었습니다." : "Your reserved LIVE was cancelled."]
          : kind === "live_24h"
      ? [
          locale === "ko"
            ? `${liveTitle}, 24시간 전이에요`
            : `${liveTitle} starts in 24 hours`,
          locale === "ko"
            ? "예약한 라이브를 미리 확인해 주세요."
            : "Check your reserved LIVE.",
        ]
      : kind === "live_10m"
        ? [
            locale === "ko"
              ? `${liveTitle}, 10분 후 시작해요`
              : `${liveTitle} starts in 10 minutes`,
            locale === "ko"
              ? "곧 라이브가 시작됩니다."
              : "Your LIVE is about to begin.",
          ]
        : kind === "survey_reminder"
          ? [
              locale === "ko"
                ? `${liveTitle} 후기를 남겨 주세요`
                : `Tell us about ${liveTitle}`,
              locale === "ko"
                ? "참여한 라이브 설문이 기다리고 있어요."
                : "Your LIVE survey is ready.",
            ]
          : kind === "level_up"
            ? [
                locale === "ko"
                  ? `팬 레벨이 ${text(payload.currentLevel, "새 레벨")}로 올랐어요`
                  : `Your fan level is now ${text(payload.currentLevel, "upgraded")}`,
                locale === "ko"
                  ? "Passport에서 새로운 팬 레벨을 확인해 보세요."
                  : "See your new level in Passport.",
              ]
            : kind === "benefit_unlocked"
              ? [
                  locale === "ko"
                    ? `${benefitTitle} 혜택이 열렸어요`
                    : `${benefitTitle} is unlocked`,
                  locale === "ko"
                    ? "팬 활동으로 새 혜택을 받을 수 있게 되었어요."
                    : "Your fan activity unlocked a new benefit.",
                ]
              : kind === "benefit_won"
                ? [locale === "ko" ? `${benefitTitle}에 당첨됐어요` : `You won ${benefitTitle}`, locale === "ko" ? "MY에서 당첨 결과를 확인해 주세요." : "Review your reward in MY."]
                : kind === "recipient_information_required"
                  ? [locale === "ko" ? "수령 정보를 입력해 주세요" : "Enter recipient information", locale === "ko" ? `${benefitTitle} 수령에 필요한 정보를 입력해 주세요.` : `Provide the information needed to receive ${benefitTitle}.`]
                  : kind === "fulfillment_meaningful_update"
                    ? [locale === "ko" ? `${benefitTitle} 수령 상태가 변경됐어요` : `${benefitTitle} status changed`, fulfillmentLabel ?? (locale === "ko" ? "MY에서 현재 수령 상태를 확인해 주세요." : "Review the current status in MY.")]
                    : kind === "collectible_claim_available"
                      ? [locale === "ko" ? "Collectible을 받을 수 있어요" : "Your Collectible is ready", locale === "ko" ? `${liveTitle} Collectible을 수령해 주세요.` : `Claim your ${liveTitle} Collectible.`]
                      : kind === "collectible_claim_expiring"
                        ? [locale === "ko" ? "Collectible 수령 기간이 곧 끝나요" : "Your Collectible claim period ends soon", locale === "ko" ? `${liveTitle} Collectible을 기간 안에 수령해 주세요.` : `Claim your ${liveTitle} Collectible before the deadline.`]
                        : kind === "benefit_available"
                          ? [
                  locale === "ko"
                    ? `${benefitTitle} 혜택이 열렸어요`
                    : `${benefitTitle} is available`,
                  locale === "ko"
                    ? "받을 수 있는 혜택을 확인해 보세요."
                    : "See the benefit now.",
                ]
                          : (() => { throw new Error("notifications projection invalid"); })();
  const sourceKey = typeof row.source_key === "string" ? row.source_key : "";
  const recipientMatch = /^recipient_information_required:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):[1-9][0-9]*$/i.exec(sourceKey);
  const deepLink = recipientLinks && kind === "recipient_information_required" && recipientMatch
    ? `/my/rewards/${recipientMatch[1]}/recipient`
    :
    storedDeepLink ??
    (kind === "benefit_available"
      ? `/benefits/${text(benefit?.id, "")}`
      : `/live/${text(live?.slug, "")}${kind === "survey_reminder" ? "/survey" : ""}`);
  return {
    id: String(row.id),
    kind,
    title: copy[0],
    detail: copy[1],
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : null,
    deepLink: deepLink as NotificationItem["deepLink"],
  };
}

export function createNotificationRepository(
  config: { url: string; serviceRoleKey: string },
  client?: Db,
): NotificationRepository {
  const db =
    client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  async function getPreferences(
    appUserId: string,
  ): Promise<NotificationPreferences> {
    const [pref, sub] = await Promise.all([
      db
        .from("notification_preferences")
        .select("live_reminders,survey_reminders,benefit_notifications,reply_notifications,official_post_notifications,schedule_notifications")
        .eq("app_user_id", appUserId)
        .maybeSingle(),
      db
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("app_user_id", appUserId)
        .is("disabled_at", null),
    ]);
    if (pref.error || sub.error)
      throw new Error("notification preferences unavailable");
    return {
      liveReminders: pref.data?.live_reminders ?? true,
      surveyReminders: pref.data?.survey_reminders ?? true,
      benefitNotifications: pref.data?.benefit_notifications ?? true,
      replyNotifications: pref.data?.reply_notifications ?? true,
      officialPostNotifications: pref.data?.official_post_notifications ?? true,
      scheduleNotifications: pref.data?.schedule_notifications ?? true,
      browserSubscription: (sub.count ?? 0) > 0 ? "subscribed" : "unsubscribed",
    };
  }
  return {
    async list({ appUserId, locale, recipientLinks = false }) {
      const drained = await db.rpc("fan_web_drain_notification_intents", { p_app_user_id: appUserId, p_limit: 100 });
      if (drained.error) throw new Error("notifications unavailable");
      const { data, error } = await db.rpc("get_owned_web_notifications", { p_app_user_id: appUserId, p_locale: locale });
      if (error) throw new Error("notifications unavailable");
      return (data ?? []).map((row: unknown) =>
        projectNotificationRow(row as Row, locale, recipientLinks),
      );
    },
    async markRead({ appUserId, notificationId }) {
      const { data, error } = await db.rpc("mark_owned_web_notifications_read", { p_app_user_id: appUserId, p_notification_id: notificationId });
      if (error) throw new Error("notification update failed");
      return Boolean(data);
    },
    async markAllRead(appUserId) {
      const { error } = await db.rpc("mark_owned_web_notifications_read", { p_app_user_id: appUserId, p_notification_id: null });
      if (error) throw new Error("notification update failed");
    },
    async putSubscription(input) {
      const endpointHash = createHash("sha256")
        .update(input.endpoint)
        .digest("hex");
      const { data, error } = await db.rpc("register_push_subscription", {
        p_app_user_id: input.appUserId,
        p_endpoint: input.endpoint,
        p_endpoint_hash: endpointHash,
        p_p256dh: input.p256dh,
        p_auth_secret: input.auth,
        p_user_agent: input.userAgent,
      });
      if (error) {
        if (error.code === "55P03")
          throw new NotificationSubscriptionBusyError();
        throw new Error("subscription save failed");
      }
      if (data !== true) throw new Error("subscription save failed");
    },
    async deleteSubscription(input) {
      const endpointHash = createHash("sha256")
        .update(input.endpoint)
        .digest("hex");
      const { error } = await db.rpc("fan_web_disable_push_subscription", { p_app_user_id: input.appUserId, p_endpoint_hash: endpointHash });
      if (error) throw new Error("subscription delete failed");
    },
    getPreferences,
    async patchPreferences(input) {
      const { error } = await db.rpc("fan_web_patch_notification_preferences", {
        p_app_user_id: input.appUserId,
        p_patch: {
          ...(input.liveReminders === undefined ? {} : { live_reminders: input.liveReminders }),
          ...(input.surveyReminders === undefined ? {} : { survey_reminders: input.surveyReminders }),
          ...(input.benefitNotifications === undefined ? {} : { benefit_notifications: input.benefitNotifications }),
          ...(input.replyNotifications === undefined ? {} : { reply_notifications: input.replyNotifications }),
          ...(input.officialPostNotifications === undefined ? {} : { official_post_notifications: input.officialPostNotifications }),
          ...(input.scheduleNotifications === undefined ? {} : { schedule_notifications: input.scheduleNotifications }),
        },
      });
      if (error) throw new Error("notification preferences update failed");
      return getPreferences(input.appUserId);
    },
    async enqueueDue(now) {
      const { data, error } = await db.rpc("enqueue_due_fan_notifications", {
        p_now: now,
      });
      if (error) throw new Error("notification enqueue failed");
      return Number(data ?? 0);
    },
  };
}
