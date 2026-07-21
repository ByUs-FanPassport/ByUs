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
): NotificationItem {
  const kind = String(row.kind) as NotificationItem["kind"];
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
  const copy =
    kind === "live_24h"
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
              : [
                  locale === "ko"
                    ? `${benefitTitle} 혜택이 열렸어요`
                    : `${benefitTitle} is available`,
                  locale === "ko"
                    ? "받을 수 있는 혜택을 확인해 보세요."
                    : "See the benefit now.",
                ];
  const deepLink =
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
        .select("live_reminders,survey_reminders,benefit_notifications")
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
      browserSubscription: (sub.count ?? 0) > 0 ? "subscribed" : "unsubscribed",
    };
  }
  return {
    async list({ appUserId, locale }) {
      const { data, error } = await db
        .from("fan_notifications")
        .select(
          "id,kind,created_at,read_at,deep_link,payload,celebrity_id,live_events(id,slug,live_event_localizations(locale,title)),benefits(id,slug,benefit_localizations(locale,title))",
        )
        .eq("app_user_id", appUserId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error("notifications unavailable");
      return (data ?? []).map((row) =>
        projectNotificationRow(row as Row, locale),
      );
    },
    async markRead({ appUserId, notificationId }) {
      const { data, error } = await db
        .from("fan_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("app_user_id", appUserId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error("notification update failed");
      return Boolean(data);
    },
    async markAllRead(appUserId) {
      const { error } = await db
        .from("fan_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("app_user_id", appUserId)
        .is("read_at", null);
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
      const { error } = await db
        .from("push_subscriptions")
        .update({ disabled_at: new Date().toISOString() })
        .eq("app_user_id", input.appUserId)
        .eq("endpoint_hash", endpointHash);
      if (error) throw new Error("subscription delete failed");
    },
    getPreferences,
    async patchPreferences(input) {
      const { error } = await db.from("notification_preferences").upsert(
        {
          app_user_id: input.appUserId,
          ...(input.liveReminders === undefined
            ? {}
            : { live_reminders: input.liveReminders }),
          ...(input.surveyReminders === undefined
            ? {}
            : { survey_reminders: input.surveyReminders }),
          ...(input.benefitNotifications === undefined
            ? {}
            : { benefit_notifications: input.benefitNotifications }),
        },
        { onConflict: "app_user_id" },
      );
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
