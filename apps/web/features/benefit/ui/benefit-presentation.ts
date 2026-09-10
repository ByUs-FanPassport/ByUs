import type { BenefitCatalogItem, BenefitLocale } from "../domain/benefit";

export function formatBenefitDateTime(value: string, locale: BenefitLocale) {
  return `${new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))} (KST)`;
}

/** Keep editorial conditions, but render an equivalent midnight deadline consistently. */
export function benefitEligibilityLabel(benefit: BenefitCatalogItem, locale: BenefitLocale) {
  const closesAt = benefit.entry?.entryClosesAt ?? benefit.claimClosesAt;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "Asia/Seoul",
  }).formatToParts(new Date(closesAt));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  if (locale !== "ko" || part("hour") !== "00" || part("minute") !== "00") return benefit.eligibilityLabel;
  const previousDay = new Date(new Date(closesAt).getTime() - 86_400_000);
  const previousDate = new Intl.DateTimeFormat("ko-KR", {
    month: "long", day: "numeric", timeZone: "Asia/Seoul",
  }).format(previousDay);
  return benefit.eligibilityLabel.replace(
    `${previousDate} 밤 12시(KST)`,
    formatBenefitDateTime(closesAt, locale),
  );
}
