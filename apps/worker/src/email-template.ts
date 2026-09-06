import { EMAIL_STAR } from "./email-star.js";
import { ExternalNotificationError } from "./external-notification-domain.js";

export const SUPPORTED_NOTIFICATION_EMAIL_TEMPLATE_KEYS = [
  "live_reserved",
  "live_10m",
  "live_changed",
  "survey_reminder",
  "benefit_available",
  "benefit_unlocked",
  "benefit_won",
  "recipient_information_required",
  "fulfillment_meaningful_update",
  "collectible_claim_available",
  "collectible_claim_expiring",
  "level_up",
] as const;

export type NotificationEmailTemplateKey =
  (typeof SUPPORTED_NOTIFICATION_EMAIL_TEMPLATE_KEYS)[number];

export type NotificationEmailFulfillmentStatus =
  | "shipping_in_transit"
  | "shipping_completed"
  | "pickup_available"
  | "pickup_completed"
  | "digital_delivered";

const DISABLED_NOTIFICATION_EMAIL_TEMPLATE_KEYS = new Set([
  "live_24h",
  "live_cancelled",
]);

const SUPPORTED_NOTIFICATION_EMAIL_TEMPLATE_KEY_SET = new Set<string>(
  SUPPORTED_NOTIFICATION_EMAIL_TEMPLATE_KEYS,
);

export function isSupportedEmailTemplate(
  templateKey: string,
): templateKey is NotificationEmailTemplateKey {
  return SUPPORTED_NOTIFICATION_EMAIL_TEMPLATE_KEY_SET.has(templateKey);
}

export function assertEmailTemplateEnabled(
  templateKey: string,
): asserts templateKey is NotificationEmailTemplateKey {
  if (DISABLED_NOTIFICATION_EMAIL_TEMPLATE_KEYS.has(templateKey)) {
    throw new ExternalNotificationError("EMAIL_TEMPLATE_DISABLED", false);
  }
  if (!isSupportedEmailTemplate(templateKey)) {
    throw new ExternalNotificationError("EMAIL_TEMPLATE_UNSUPPORTED", false);
  }
}

export interface NotificationEmailContext {
  artist?: string | undefined;
  title?: string | undefined;
  imageUrl?: string | undefined;
  startsAt?: string | undefined;
  actionAt?: string | undefined;
  fulfillmentStatus?: NotificationEmailFulfillmentStatus | undefined;
  newLevel?: string | undefined;
}

export interface NotificationEmailInlineAssets {
  logoContentId: string;
  posterContentId?: string | undefined;
}

export interface NotificationEmailInput {
  title: string;
  detail: string;
  deepLink: string;
  locale: "ko" | "en";
  templateKey: string;
  context?: NotificationEmailContext | undefined;
  inlineAssets?: NotificationEmailInlineAssets | undefined;
}

export interface RenderedNotificationEmail {
  subject: string;
  html: string;
  text: string;
}

const SETTINGS_URL = "https://byus.kr/settings";
const DEFAULT_LOGO_URL =
  "https://byus.kr/images/guest-home/byus-wordmark-transparent.png";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

type EmailKind = "live" | "survey" | "benefit" | "collectible" | "fan";

interface EmailCopy {
  subject: string;
  title: string;
  detail: string;
  category: string;
  cta: string;
  settings: string;
  cardFallback: string;
  valueLabel?: string;
}

const COPY: Record<
  NotificationEmailTemplateKey,
  Record<"ko" | "en", Omit<EmailCopy, "settings">>
> = {
  live_reserved: {
    ko: { subject: "LIVE 예약이 완료됐어요", title: "LIVE 예약이 완료됐어요", detail: "시작 전에 알림을 보내드릴게요.", category: "LIVE", cta: "LIVE 보기", cardFallback: "예약한 LIVE" },
    en: { subject: "Your LIVE reservation is confirmed", title: "Your LIVE reservation is confirmed", detail: "We’ll remind you before it begins.", category: "LIVE", cta: "View LIVE", cardFallback: "Your reserved LIVE" },
  },
  live_10m: {
    ko: { subject: "LIVE가 10분 뒤 시작해요", title: "LIVE가 10분 뒤 시작해요", detail: "곧 만나요. 지금 LIVE를 확인해 주세요.", category: "LIVE", cta: "LIVE 보기", cardFallback: "곧 시작하는 LIVE" },
    en: { subject: "Your LIVE starts in 10 minutes", title: "Your LIVE starts in 10 minutes", detail: "See you soon. Check the LIVE now.", category: "LIVE", cta: "View LIVE", cardFallback: "Your upcoming LIVE" },
  },
  live_changed: {
    ko: { subject: "LIVE 일정이 변경됐어요", title: "LIVE 일정이 변경됐어요", detail: "변경된 시작 시간을 확인해 주세요.", category: "LIVE", cta: "변경된 일정 보기", cardFallback: "일정이 변경된 LIVE" },
    en: { subject: "The LIVE schedule has changed", title: "The LIVE schedule has changed", detail: "Please check the updated start time.", category: "LIVE", cta: "View updated schedule", cardFallback: "LIVE with an updated schedule" },
  },
  survey_reminder: {
    ko: { subject: "LIVE는 어떠셨나요?", title: "LIVE는 어떠셨나요?", detail: "즐거웠던 순간과 의견을 후기로 남겨 주세요.", category: "후기", cta: "후기 작성하기", cardFallback: "참여한 LIVE" },
    en: { subject: "How was the LIVE?", title: "How was the LIVE?", detail: "Share your favorite moments and feedback with us.", category: "FEEDBACK", cta: "Share feedback", cardFallback: "The LIVE you joined" },
  },
  benefit_available: {
    ko: { subject: "새로운 Benefit이 열렸어요", title: "새로운 Benefit이 열렸어요", detail: "팬을 위한 새로운 혜택을 확인해 보세요.", category: "BENEFIT", cta: "Benefit 확인하기", cardFallback: "새로운 Benefit" },
    en: { subject: "A new Benefit is available", title: "A new Benefit is available", detail: "Discover a new benefit made for fans.", category: "BENEFIT", cta: "View Benefit", cardFallback: "New Benefit" },
  },
  benefit_unlocked: {
    ko: { subject: "Benefit 자격을 달성했어요", title: "Benefit 자격을 달성했어요", detail: "팬 활동으로 새로운 혜택이 열렸어요.", category: "BENEFIT", cta: "Benefit 확인하기", cardFallback: "달성한 Benefit" },
    en: { subject: "You unlocked a Benefit", title: "You unlocked a Benefit", detail: "Your fan activity has unlocked a new benefit.", category: "BENEFIT", cta: "View Benefit", cardFallback: "Unlocked Benefit" },
  },
  benefit_won: {
    ko: { subject: "Benefit에 당첨됐어요", title: "Benefit에 당첨됐어요", detail: "축하해요! 당첨된 혜택과 다음 단계를 확인해 주세요.", category: "BENEFIT", cta: "당첨 내용 확인하기", cardFallback: "당첨된 Benefit" },
    en: { subject: "You won a Benefit", title: "You won a Benefit", detail: "Congratulations! Check your benefit and the next steps.", category: "BENEFIT", cta: "View your Benefit", cardFallback: "Your winning Benefit" },
  },
  recipient_information_required: {
    ko: { subject: "수령 정보를 입력해 주세요", title: "수령 정보를 입력해 주세요", detail: "Benefit을 받을 수 있도록 필요한 정보를 입력해 주세요.", category: "BENEFIT", cta: "수령 정보 입력하기", cardFallback: "수령할 Benefit" },
    en: { subject: "Enter your delivery details", title: "Enter your delivery details", detail: "Provide the details needed to receive your Benefit.", category: "BENEFIT", cta: "Enter delivery details", cardFallback: "Benefit awaiting your details" },
  },
  fulfillment_meaningful_update: {
    ko: { subject: "Benefit 수령 상태가 변경됐어요", title: "Benefit 수령 상태가 변경됐어요", detail: "최신 수령 상태를 확인해 주세요.", category: "BENEFIT", cta: "수령 상태 확인하기", cardFallback: "수령 중인 Benefit" },
    en: { subject: "Your Benefit status has changed", title: "Your Benefit status has changed", detail: "Check the latest delivery status.", category: "BENEFIT", cta: "View delivery status", cardFallback: "Benefit in fulfillment" },
  },
  collectible_claim_available: {
    ko: { subject: "Collectible을 받을 수 있어요", title: "Collectible을 받을 수 있어요", detail: "수령 기간 안에 나만의 Collectible을 받아 주세요.", category: "COLLECTIBLE", cta: "Collectible 받기", cardFallback: "나의 Collectible" },
    en: { subject: "Your Collectible is ready to claim", title: "Your Collectible is ready to claim", detail: "Claim your Collectible before the claim window closes.", category: "COLLECTIBLE", cta: "Claim Collectible", cardFallback: "Your Collectible" },
  },
  collectible_claim_expiring: {
    ko: { subject: "Collectible 수령이 곧 마감돼요", title: "Collectible 수령이 곧 마감돼요", detail: "놓치지 않도록 수령 마감 전에 받아 주세요.", category: "COLLECTIBLE", cta: "Collectible 받기", cardFallback: "수령 대기 중인 Collectible" },
    en: { subject: "Your Collectible claim window closes soon", title: "Your Collectible claim window closes soon", detail: "Claim it before the deadline so you don’t miss out.", category: "COLLECTIBLE", cta: "Claim Collectible", cardFallback: "Collectible awaiting claim" },
  },
  level_up: {
    ko: { subject: "팬 레벨이 올랐어요", title: "팬 레벨이 올랐어요", detail: "꾸준한 팬 활동으로 새로운 레벨을 달성했어요.", category: "FAN LEVEL", cta: "팬 패스포트 보기", cardFallback: "새로운 팬 레벨", valueLabel: "NEW LEVEL" },
    en: { subject: "Your fan level went up", title: "Your fan level went up", detail: "Your fan activity has earned you a new level.", category: "FAN LEVEL", cta: "View fan passport", cardFallback: "Your new fan level", valueLabel: "NEW LEVEL" },
  },
};

const FULFILLMENT_COPY: Record<NotificationEmailFulfillmentStatus, Record<"ko" | "en", Pick<EmailCopy, "subject" | "title" | "detail"> & { value: string }>> = {
  shipping_in_transit: {
    ko: { subject: "Benefit 배송이 시작됐어요", title: "Benefit 배송이 시작됐어요", detail: "Benefit이 배송 중이에요. 배송 상태를 확인해 주세요.", value: "배송 중" },
    en: { subject: "Your Benefit is on the way", title: "Your Benefit is on the way", detail: "Your Benefit has shipped. Check its delivery status.", value: "In transit" },
  },
  shipping_completed: {
    ko: { subject: "Benefit 배송이 완료됐어요", title: "Benefit 배송이 완료됐어요", detail: "Benefit이 도착했어요. 안전하게 받았는지 확인해 주세요.", value: "배송 완료" },
    en: { subject: "Your Benefit has been delivered", title: "Your Benefit has been delivered", detail: "Your Benefit has arrived. Please confirm you received it safely.", value: "Delivered" },
  },
  pickup_available: {
    ko: { subject: "Benefit을 현장에서 받을 수 있어요", title: "Benefit을 현장에서 받을 수 있어요", detail: "지정된 장소와 시간을 확인하고 수령해 주세요.", value: "현장 수령 가능" },
    en: { subject: "Your Benefit is ready for pickup", title: "Your Benefit is ready for pickup", detail: "Check the pickup location and time before you go.", value: "Ready for pickup" },
  },
  pickup_completed: {
    ko: { subject: "Benefit 현장 수령이 완료됐어요", title: "Benefit 현장 수령이 완료됐어요", detail: "현장 수령이 완료된 것으로 기록됐어요.", value: "현장 수령 완료" },
    en: { subject: "Your Benefit pickup is complete", title: "Your Benefit pickup is complete", detail: "Your in-person pickup has been recorded as complete.", value: "Pickup complete" },
  },
  digital_delivered: {
    ko: { subject: "디지털 Benefit이 전달됐어요", title: "디지털 Benefit이 전달됐어요", detail: "전달된 디지털 Benefit을 지금 확인해 보세요.", value: "디지털 전달 완료" },
    en: { subject: "Your digital Benefit is ready", title: "Your digital Benefit is ready", detail: "Your digital Benefit has been delivered. View it now.", value: "Digital delivery complete" },
  },
};

function emailKind(templateKey: NotificationEmailTemplateKey): EmailKind {
  if (templateKey.startsWith("live_")) return "live";
  if (templateKey === "survey_reminder") return "survey";
  if (templateKey.startsWith("collectible_")) return "collectible";
  if (templateKey === "level_up") return "fan";
  return "benefit";
}

function localizedCopy(
  templateKey: NotificationEmailTemplateKey,
  locale: "ko" | "en",
  context: NotificationEmailContext | undefined,
): EmailCopy & { value?: string } {
  const base = COPY[templateKey][locale];
  if (templateKey !== "fulfillment_meaningful_update") {
    return { ...base, settings: locale === "ko" ? "알림 설정" : "Notification settings" };
  }
  const status = context?.fulfillmentStatus;
  if (!status || !FULFILLMENT_COPY[status]) {
    throw new ExternalNotificationError("EMAIL_TEMPLATE_CONTEXT_INVALID", false);
  }
  const variant = FULFILLMENT_COPY[status][locale];
  return { ...base, ...variant, settings: locale === "ko" ? "알림 설정" : "Notification settings", valueLabel: locale === "ko" ? "수령 상태" : "DELIVERY STATUS" };
}

function formatStartsAt(value: string | undefined, locale: "ko" | "en"): { full: string; date: string; time: string } | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const weekday = parts.weekday;
  const hour = Number(parts.hour);
  const minute = parts.minute;
  if (!year || !month || !day || !weekday || !Number.isInteger(hour) || !minute) {
    return undefined;
  }

  const hour12 = hour % 12 || 12;
  const period = hour < 12 ? (locale === "ko" ? "오전" : "AM") : locale === "ko" ? "오후" : "PM";
  if (locale === "ko") {
    const koWeekday: Record<string, string> = {
      Sun: "일",
      Mon: "월",
      Tue: "화",
      Wed: "수",
      Thu: "목",
      Fri: "금",
      Sat: "토",
    };
    const localizedWeekday = koWeekday[weekday];
    if (!localizedWeekday) return undefined;
    return { full: `${year}. ${month}. ${day}. (${localizedWeekday}) ${period} ${hour12}:${minute} KST`, date: `${year}. ${month}. ${day}`, time: `${period} ${hour12}:${minute} KST` };
  }

  const enMonths = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthName = enMonths[Number(month) - 1];
  if (!monthName) return undefined;
  return { full: `${weekday}, ${monthName} ${Number(day)}, ${year} · ${hour12}:${minute} ${period} KST`, date: `${monthName} ${Number(day)}, ${year}`, time: `${hour12}:${minute} ${period} KST` };
}

export function renderNotificationEmail(
  input: NotificationEmailInput,
): RenderedNotificationEmail {
  assertEmailTemplateEnabled(input.templateKey);
  const templateKey = input.templateKey;
  const kind = emailKind(templateKey);
  const copy = localizedCopy(templateKey, input.locale, input.context);
  if (templateKey === "level_up" && !input.context?.newLevel?.trim()) {
    throw new ExternalNotificationError("EMAIL_TEMPLATE_CONTEXT_INVALID", false);
  }
  const imageUrl = safeImageUrl(input.context?.imageUrl);
  const logoSource =
    input.inlineAssets?.logoContentId === "byus-logo" ? "cid:byus-logo" : DEFAULT_LOGO_URL;
  const posterSource =
    input.inlineAssets?.posterContentId === "byus-poster" ? "cid:byus-poster" : imageUrl;
  const scheduleSource = kind === "live" ? input.context?.startsAt : input.context?.actionAt;
  const schedule = formatStartsAt(scheduleSource, input.locale);
  const startsAt = schedule?.full;
  const starSource = input.inlineAssets?.logoContentId === "byus-logo" ? "cid:byus-star" : `data:image/png;base64,${EMAIL_STAR.toString("base64")}`;
  const eventTitle = input.context?.title?.trim()
    || (templateKey === "level_up" ? input.context?.artist?.trim() : undefined)
    || copy.cardFallback;
  const cardValue = templateKey === "level_up" ? input.context?.newLevel?.trim() : copy.value;

  const title = escapeHtml(copy.title);
  const detail = escapeHtml(copy.detail);
  const escapedEventTitle = escapeHtml(eventTitle);
  const eventTitleSize = eventTitle.length > 18 ? 32 : 38;
  const deepLink = escapeHtml(input.deepLink);
  const category = escapeHtml(copy.category);
  const cta = escapeHtml(copy.cta);
  const settings = escapeHtml(copy.settings);
  const lang = input.locale === "ko" ? "ko" : "en";
  const settingsUrl = `${SETTINGS_URL}?locale=${lang}`;

  const poster = posterSource
    ? `<img src="${escapeHtml(posterSource)}" alt="${escapedEventTitle}" width="600" crossorigin="anonymous" style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"><div class="email-poster-tail" style="height:216px;background-color:#100913;background-image:linear-gradient(#09070d,#23102d);font-size:0;line-height:0;">&nbsp;</div>`
    : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#09070d;">
        <tr>
          <td style="padding:54px 36px 58px 36px;text-align:center;">
            <div style="font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;letter-spacing:4px;color:#ff0a78;text-transform:uppercase;">${category}</div>
            <div style="padding-top:18px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:36px;line-height:43px;font-weight:800;letter-spacing:-1px;color:#ffffff;word-break:keep-all;overflow-wrap:anywhere;">${escapedEventTitle}</div>
            <div style="width:52px;height:4px;margin:28px auto 0 auto;background-color:#ff0a78;font-size:0;line-height:0;">&nbsp;</div>
          </td>
        </tr>
      </table>`;

  const dateLabel = kind === "live"
    ? undefined
    : input.locale === "ko"
      ? "마감"
      : "DEADLINE";
  const dateRows = schedule
    ? `${dateLabel ? `<tr><td style="padding:8px 0 0;border-top:1px solid #cccccc;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:2px;color:#ff0a78;text-align:center;">${dateLabel}</td></tr>` : ""}
       <tr><td class="email-date" style="padding:12px 0 14px;${dateLabel ? "" : "border-top:1px solid #cccccc;"}font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:50px;line-height:62px;font-weight:400;letter-spacing:-2px;color:#050505;text-align:center;white-space:nowrap;">${escapeHtml(schedule.date)}</td></tr>
       <tr><td class="email-time" style="padding:14px 0 18px;border-top:1px solid #cccccc;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:24px;line-height:31px;font-weight:400;color:#111111;text-align:center;">${escapeHtml(schedule.time)}</td></tr>`
    : "";
  const valueRows = cardValue
    ? `<tr><td style="padding:12px 0 4px;border-top:1px solid #cccccc;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:2px;color:#ff0a78;text-align:center;text-transform:uppercase;">${escapeHtml(copy.valueLabel ?? "")}</td></tr>
       <tr><td style="padding:4px 0 20px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:30px;line-height:38px;font-weight:700;color:#111111;text-align:center;word-break:keep-all;overflow-wrap:anywhere;">${escapeHtml(cardValue)}</td></tr>`
    : "";

  const informationCard = `<div class="${posterSource ? "email-card-overlap" : "email-card-plain"}" style="${posterSource ? "margin-top:-234px;position:relative;z-index:1;" : "margin-top:20px;"}">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #d3d3d3;background-color:#ffffff;">
        <tr><td class="email-card-inner" style="padding:14px 24px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
            <tr><td style="vertical-align:middle;"><div style="height:1px;background-color:#ff9bc5;font-size:0;line-height:0;">&nbsp;</div></td><td width="58" align="center" style="width:58px;padding:0 10px;"><img src="${starSource}" alt="" width="32" height="32" style="display:block;width:32px;height:32px;border:0;"></td><td style="vertical-align:middle;"><div style="height:1px;background-color:#ff9bc5;font-size:0;line-height:0;">&nbsp;</div></td></tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
            <tr><td class="email-event-title" style="padding:12px 0 16px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:${eventTitleSize}px;line-height:42px;font-weight:700;letter-spacing:-0.8px;text-wrap:balance;color:#080808;text-align:center;word-break:keep-all;overflow-wrap:anywhere;">${escapedEventTitle}</td></tr>
            ${dateRows}
            ${valueRows}
          </table>
        </td></tr>
      </table>
    </div>`;

  const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${title}</title>
    <!--[if !mso]><!--><style>
      @font-face{font-family:'Pretendard';font-style:normal;font-weight:400;font-display:swap;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Regular.woff2') format('woff2');}
      @font-face{font-family:'Pretendard';font-style:normal;font-weight:800;font-display:swap;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-ExtraBold.woff2') format('woff2');}
      @font-face{font-family:'Pretendard';font-style:normal;font-weight:700;font-display:swap;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-Bold.woff2') format('woff2');}
    </style><!--<![endif]-->
    <style>@media only screen and (max-width:480px){.email-title{font-size:32px!important;line-height:40px!important;}.email-poster-tail{height:140px!important;}.email-intro{padding-left:24px!important;padding-right:24px!important;}.email-card-overlap{margin-top:-152px!important;}.email-card-inner{padding-left:16px!important;padding-right:16px!important;}.email-event-title{font-size:24px!important;line-height:32px!important;}.email-date{font-size:38px!important;line-height:50px!important;letter-spacing:-1px!important;}.email-time{font-size:20px!important;line-height:28px!important;}}</style>
    <!--[if mso]><style>.email-card-overlap{margin-top:20px!important;}</style><![endif]-->
  </head>
  <body style="margin:0;padding:0;background-color:#f2f2f2;color:#111111;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f2f2f2;">
      <tr>
        <td align="center" style="padding:0;">
          <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;">
            <tr>
              <td align="center" style="padding:18px 24px 20px 24px;">
                <img src="${logoSource}" alt="ByUs" width="120" height="49" crossorigin="anonymous" style="display:block;width:120px;height:49px;border:0;line-height:100%;outline:none;text-decoration:none;">
              </td>
            </tr>
            <tr>
              <td class="email-intro" style="padding:10px 36px 26px;">
                <div style="font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:800;letter-spacing:2px;color:#ff0a78;text-transform:uppercase;">${category}</div>
                <h1 class="email-title" style="margin:12px 0 0 0;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:44px;line-height:54px;font-weight:700;letter-spacing:-1.5px;color:#000000;word-break:keep-all;overflow-wrap:anywhere;">${title}</h1>
                <div style="margin-top:12px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:18px;line-height:27px;font-weight:400;color:#3f3f3f;word-break:keep-all;overflow-wrap:anywhere;">${detail}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0;">${poster}</td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px;">${informationCard}</td>
            </tr>
            <tr>
              <td style="padding:0 30px 22px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#ff0a78;border-radius:8px;">
                  <tr>
                    <td align="center" style="padding:0;">
                      <a href="${deepLink}" style="display:block;padding:18px 20px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:27px;line-height:34px;font-weight:700;color:#ffffff;text-align:center;text-decoration:none;">${cta}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 20px;border-top:1px solid #eeeeee;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#666666;text-align:center;">
                <div style="font-weight:400;">ByUs · Your Bias</div>
                <div style="padding-top:7px;"><a href="${settingsUrl}" style="color:#666666;text-decoration:underline;">${settings}</a></div>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textParts = [copy.title, "", copy.detail];
  if (eventTitle !== copy.title) textParts.push("", eventTitle);
  if (startsAt) textParts.push(startsAt);
  if (cardValue) textParts.push(`${copy.valueLabel}: ${cardValue}`);
  textParts.push("", `${copy.cta}: ${input.deepLink}`, "", `${copy.settings}: ${settingsUrl}`);

  return { subject: copy.subject, html, text: textParts.join("\n") };
}
