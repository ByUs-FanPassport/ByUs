import { messages as localizedMessages } from "@/i18n/catalogs/features__live__ui__live-reservation-mark";
import { translate } from "@/i18n/messages";
import { Check } from "lucide-react";
import type { LiveTimeLocale } from "../domain/live-time-display";
import styles from "./live-reservation-mark.module.css";

function CheckMark() { return <Check className={styles.checkIcon} aria-hidden="true" strokeWidth={2.5} />; }

export function LiveReservationMark({ locale, className }: { locale: LiveTimeLocale; className?: string }) {
  const label = locale === "ko" ? "예약 완료" : translate(locale, localizedMessages.mef20a49f2ebc, "Reserved");
  return <span className={`${styles.mark} ${className ?? ""}`} title={label} data-live-reserved="true">
    <CheckMark />
    <span className={styles.srOnly}>{label}</span>
  </span>;
}

export function LiveReservationLegend({ locale, className }: { locale: LiveTimeLocale; className?: string }) {
  return <span className={`${styles.legend} ${className ?? ""}`}>
    <span className={styles.mark} aria-hidden="true"><CheckMark /></span>
    <span>{locale === "ko" ? "내 예약" : translate(locale, localizedMessages.m97fcbcf49b2e, "My reservation")}</span>
  </span>;
}
