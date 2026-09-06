import { describe, expect, it } from "vitest";
import { ExternalNotificationError } from "../src/external-notification-domain.js";
import {
  assertEmailTemplateEnabled,
  renderNotificationEmail,
  type NotificationEmailContext,
  type NotificationEmailTemplateKey,
} from "../src/email-template.js";

interface Scenario {
  key: NotificationEmailTemplateKey;
  context?: NotificationEmailContext;
  ko: readonly [subject: string, detail: string, cta: string, marker: string];
  en: readonly [subject: string, detail: string, cta: string, marker: string];
}

const storedPayload = {
  title: "저장된 한국어 제목",
  detail: "저장된 한국어 상세",
  deepLink: "https://byus.kr/live/nova?from=email&ref=all",
};

const scenarios: Scenario[] = [
  { key: "live_reserved", context: { title: "NOVA FAN LIVE", startsAt: "2026-09-20T10:00:00Z" },
    ko: ["LIVE 예약이 완료됐어요", "시작 전에 알림을 보내드릴게요.", "LIVE 보기", "오후 7:00 KST"],
    en: ["Your LIVE reservation is confirmed", "We’ll remind you before it begins.", "View LIVE", "7:00 PM KST"] },
  { key: "live_10m", context: { title: "NOVA FAN LIVE", startsAt: "2026-09-20T10:00:00Z" },
    ko: ["LIVE가 10분 뒤 시작해요", "곧 만나요. 지금 LIVE를 확인해 주세요.", "LIVE 보기", "2026. 09. 20"],
    en: ["Your LIVE starts in 10 minutes", "See you soon. Check the LIVE now.", "View LIVE", "Sep 20, 2026"] },
  { key: "live_changed", context: { title: "NOVA FAN LIVE", startsAt: "2026-09-21T11:30:00Z" },
    ko: ["LIVE 일정이 변경됐어요", "변경된 시작 시간을 확인해 주세요.", "변경된 일정 보기", "오후 8:30 KST"],
    en: ["The LIVE schedule has changed", "Please check the updated start time.", "View updated schedule", "8:30 PM KST"] },
  { key: "survey_reminder", context: { title: "NOVA FAN LIVE", actionAt: "2026-09-23T14:00:00Z" },
    ko: ["LIVE는 어떠셨나요?", "즐거웠던 순간과 의견을 후기로 남겨 주세요.", "후기 작성하기", "마감"],
    en: ["How was the LIVE?", "Share your favorite moments and feedback with us.", "Share feedback", "DEADLINE"] },
  { key: "benefit_available", context: { title: "Signed Polaroid", actionAt: "2026-09-30T14:59:00Z" },
    ko: ["새로운 Benefit이 열렸어요", "팬을 위한 새로운 혜택을 확인해 보세요.", "Benefit 확인하기", "Signed Polaroid"],
    en: ["A new Benefit is available", "Discover a new benefit made for fans.", "View Benefit", "Signed Polaroid"] },
  { key: "benefit_unlocked", context: { title: "Soundcheck Pass", actionAt: "2026-09-30T14:59:00Z" },
    ko: ["Benefit 자격을 달성했어요", "팬 활동으로 새로운 혜택이 열렸어요.", "Benefit 확인하기", "Soundcheck Pass"],
    en: ["You unlocked a Benefit", "Your fan activity has unlocked a new benefit.", "View Benefit", "Soundcheck Pass"] },
  { key: "benefit_won", context: { title: "Video Call Ticket", actionAt: "2026-09-25T14:59:00Z" },
    ko: ["Benefit에 당첨됐어요", "축하해요! 당첨된 혜택과 다음 단계를 확인해 주세요.", "당첨 내용 확인하기", "Video Call Ticket"],
    en: ["You won a Benefit", "Congratulations! Check your benefit and the next steps.", "View your Benefit", "Video Call Ticket"] },
  { key: "recipient_information_required", context: { title: "Tour Merchandise", actionAt: "2026-09-25T14:59:00Z" },
    ko: ["수령 정보를 입력해 주세요", "Benefit을 받을 수 있도록 필요한 정보를 입력해 주세요.", "수령 정보 입력하기", "Tour Merchandise"],
    en: ["Enter your delivery details", "Provide the details needed to receive your Benefit.", "Enter delivery details", "Tour Merchandise"] },
  ...([
    ["shipping_in_transit", "Benefit 배송이 시작됐어요", "Benefit이 배송 중이에요. 배송 상태를 확인해 주세요.", "배송 중", "Your Benefit is on the way", "Your Benefit has shipped. Check its delivery status.", "In transit"],
    ["shipping_completed", "Benefit 배송이 완료됐어요", "Benefit이 도착했어요. 안전하게 받았는지 확인해 주세요.", "배송 완료", "Your Benefit has been delivered", "Your Benefit has arrived. Please confirm you received it safely.", "Delivered"],
    ["pickup_available", "Benefit을 현장에서 받을 수 있어요", "지정된 장소와 시간을 확인하고 수령해 주세요.", "현장 수령 가능", "Your Benefit is ready for pickup", "Check the pickup location and time before you go.", "Ready for pickup"],
    ["pickup_completed", "Benefit 현장 수령이 완료됐어요", "현장 수령이 완료된 것으로 기록됐어요.", "현장 수령 완료", "Your Benefit pickup is complete", "Your in-person pickup has been recorded as complete.", "Pickup complete"],
    ["digital_delivered", "디지털 Benefit이 전달됐어요", "전달된 디지털 Benefit을 지금 확인해 보세요.", "디지털 전달 완료", "Your digital Benefit is ready", "Your digital Benefit has been delivered. View it now.", "Digital delivery complete"],
  ] as const).map(([fulfillmentStatus, koSubject, koDetail, koMarker, enSubject, enDetail, enMarker]): Scenario => ({
    key: "fulfillment_meaningful_update",
    context: { title: "Fan Gift", fulfillmentStatus },
    ko: [koSubject, koDetail, "수령 상태 확인하기", koMarker],
    en: [enSubject, enDetail, "View delivery status", enMarker],
  })),
  { key: "collectible_claim_available", context: { title: "NOVA First LIVE Collectible", actionAt: "2026-09-24T14:59:00Z" },
    ko: ["Collectible을 받을 수 있어요", "수령 기간 안에 나만의 Collectible을 받아 주세요.", "Collectible 받기", "마감"],
    en: ["Your Collectible is ready to claim", "Claim your Collectible before the claim window closes.", "Claim Collectible", "DEADLINE"] },
  { key: "collectible_claim_expiring", context: { title: "NOVA First LIVE Collectible", actionAt: "2026-09-24T14:59:00Z" },
    ko: ["Collectible 수령이 곧 마감돼요", "놓치지 않도록 수령 마감 전에 받아 주세요.", "Collectible 받기", "오후 11:59 KST"],
    en: ["Your Collectible claim window closes soon", "Claim it before the deadline so you don’t miss out.", "Claim Collectible", "11:59 PM KST"] },
  { key: "level_up", context: { title: "NOVA", newLevel: "SUPER FAN" },
    ko: ["팬 레벨이 올랐어요", "꾸준한 팬 활동으로 새로운 레벨을 달성했어요.", "팬 패스포트 보기", "SUPER FAN"],
    en: ["Your fan level went up", "Your fan activity has earned you a new level.", "View fan passport", "SUPER FAN"] },
];

describe("notification email template copy", () => {
  it.each(scenarios.flatMap((scenario) => (["ko", "en"] as const).map((locale) => ({
    name: `${scenario.key}:${scenario.context?.fulfillmentStatus ?? "default"}:${locale}`,
    scenario,
    locale,
  }))))("renders localized scenario $name", ({ scenario, locale }) => {
    const [subject, detail, cta, marker] = scenario[locale];
    const result = renderNotificationEmail({ ...storedPayload, templateKey: scenario.key, locale, context: scenario.context });

    expect(result.subject).toBe(subject);
    expect(result.html).toContain(`<html lang="${locale}">`);
    expect(result.html).toContain(subject);
    expect(result.html).toContain(detail);
    expect(result.html).toContain(cta);
    expect(result.html).toContain(marker);
    expect(result.text).toContain(subject);
    expect(result.text).toContain(`${cta}: ${storedPayload.deepLink}`);
    expect(result.html).not.toContain(storedPayload.title);
    expect(result.html).not.toContain(storedPayload.detail);
    if (locale === "en") {
      expect(result.subject).not.toMatch(/[가-힣]/);
      expect(result.html).not.toContain("저장된 한국어");
      expect(result.text).not.toContain("저장된 한국어");
    }
  });

  it("covers exactly 16 semantic scenarios and 32 localized cases", () => {
    expect(scenarios).toHaveLength(16);
    expect(scenarios.flatMap((item) => [item.ko, item.en])).toHaveLength(32);
  });
});

describe("notification email template layout and safety", () => {
  const base = {
    ...storedPayload,
    locale: "en" as const,
    templateKey: "live_reserved",
    context: {
      title: "A VERY LONG INTERNATIONAL FAN LIVE TITLE THAT MUST WRAP CLEANLY ON NARROW EMAIL CLIENTS",
      imageUrl: "https://cdn.byus.kr/posters/nova.jpg?width=1200&format=webp",
      startsAt: "2026-09-20T10:00:00Z",
    },
  };

  it("preserves B v3 poster overlap, star, date, CTA, logo and footer", () => {
    const result = renderNotificationEmail({ ...base, inlineAssets: { logoContentId: "byus-logo", posterContentId: "byus-poster" } });
    expect(result.html).toContain("email-card-overlap");
    expect(result.html).toContain("margin-top:-234px");
    expect(result.html).toContain('src="cid:byus-star"');
    expect(result.html).toContain("Sep 20, 2026");
    expect(result.html).toContain("ByUs · Your Bias");
    expect(result.html).toContain("Notification settings");
    expect(result.html).toContain("@media only screen and (max-width:480px)");
    expect(result.html).toContain("overflow-wrap:anywhere");
  });

  it("uses the same branded card system when an image is missing", () => {
    const result = renderNotificationEmail({ ...base, context: { title: "NOVA FAN LIVE", startsAt: base.context.startsAt } });
    expect(result.html).toContain("email-card-plain");
    expect(result.html).toContain("background-color:#09070d");
    expect(result.html).toContain("NOVA FAN LIVE");
    expect(result.html).not.toContain('class="email-card-overlap"');
  });

  it.each(["live_24h", "live_cancelled"])("permanently rejects disabled template %s", (templateKey) => {
    expect(() => assertEmailTemplateEnabled(templateKey)).toThrowError(expect.objectContaining<Partial<ExternalNotificationError>>({ code: "EMAIL_TEMPLATE_DISABLED", retryable: false }));
    expect(() => renderNotificationEmail({ ...base, templateKey })).toThrowError(expect.objectContaining<Partial<ExternalNotificationError>>({ code: "EMAIL_TEMPLATE_DISABLED", retryable: false }));
  });

  it("permanently rejects unknown templates", () => {
    expect(() => renderNotificationEmail({ ...base, templateKey: "account_update" })).toThrowError(expect.objectContaining<Partial<ExternalNotificationError>>({ code: "EMAIL_TEMPLATE_UNSUPPORTED", retryable: false }));
  });

  it.each([
    { templateKey: "fulfillment_meaningful_update", context: { title: "Fan Gift" } },
    { templateKey: "level_up", context: { title: "NOVA" } },
  ])("rejects missing semantic context for $templateKey", ({ templateKey, context }) => {
    expect(() => renderNotificationEmail({ ...base, templateKey, context })).toThrowError(expect.objectContaining<Partial<ExternalNotificationError>>({ code: "EMAIL_TEMPLATE_CONTEXT_INVALID", retryable: false }));
  });

  it.each(["javascript:alert(1)", "data:image/png;base64,AAAA", "http://cdn.byus.kr/poster.jpg", "https://user:password@cdn.byus.kr/poster.jpg"])("omits unsafe poster URL %j", (imageUrl) => {
    const result = renderNotificationEmail({ ...base, context: { ...base.context, imageUrl } });
    expect(result.html).toContain("email-card-plain");
    expect(result.html).not.toContain(imageUrl);
  });

  it("escapes entity text, image URL and action URL", () => {
    const result = renderNotificationEmail({
      ...base,
      deepLink: 'https://byus.kr/live/x?next=" onclick="alert(1)&a=<b>',
      context: { ...base.context, title: 'Artist "A" <svg onload=alert(3)>', imageUrl: 'https://cdn.byus.kr/poster.png?caption="x"&size=<large>' },
    });
    expect(result.html).not.toContain("<svg");
    expect(result.html).not.toContain('onclick="alert(1)');
    expect(result.html).toContain("Artist &quot;A&quot; &lt;svg onload=alert(3)&gt;");
    expect(result.html).toContain("caption=%22x%22&amp;size=%3Clarge%3E");
    expect(result.html).toContain("next=&quot; onclick=&quot;alert(1)&amp;a=&lt;b&gt;");
  });
});

it("identifies the artist for a level-up notification without a content title",()=>{
 const email=renderNotificationEmail({title:"unused",detail:"unused",deepLink:"https://byus.kr/passports?locale=en",locale:"en",templateKey:"level_up",context:{artist:"Artist <name>",newLevel:"Gold"}});
 expect(email.html).toContain("Artist &lt;name&gt;");
 expect(email.text).toContain("Artist <name>");
 expect(email.html).not.toContain("Artist <name>");
});
