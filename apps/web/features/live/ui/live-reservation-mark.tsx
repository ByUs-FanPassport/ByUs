import { Check } from "lucide-react";
import type { LiveTimeLocale } from "../domain/live-time-display";
import styles from "./live-reservation-mark.module.css";

function CheckMark() { return <Check className={styles.checkIcon} aria-hidden="true" strokeWidth={2.5} />; }

export function LiveReservationMark({ locale, className }: { locale: LiveTimeLocale; className?: string }) {
  const label = locale === "ko" ? "예약 완료" : "Reserved";
  return <span className={`${styles.mark} ${className ?? ""}`} title={label} data-live-reserved="true">
    <CheckMark />
    <span className={styles.srOnly}>{label}</span>
  </span>;
}

export function LiveReservationLegend({ locale, className }: { locale: LiveTimeLocale; className?: string }) {
  return <span className={`${styles.legend} ${className ?? ""}`}>
    <span className={styles.mark} aria-hidden="true"><CheckMark /></span>
    <span>{locale === "ko" ? "내 예약" : "My reservation"}</span>
  </span>;
}
