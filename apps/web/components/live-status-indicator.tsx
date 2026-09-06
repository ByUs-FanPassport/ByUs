import type { EffectiveLiveStatus } from "../features/live/domain/live-event";
import styles from "./live-status-indicator.module.css";

const labels = {
  ko: { live: "LIVE 진행중", scheduled: "LIVE 예정" },
  en: { live: "LIVE NOW", scheduled: "UPCOMING LIVE" },
} as const;

export function LiveStatusIndicator({
  status,
  locale,
  className,
  label,
  density = "comfortable",
}: {
  status: Extract<EffectiveLiveStatus, "live" | "scheduled">;
  locale: "ko" | "en";
  className?: string;
  label?: string;
  density?: "comfortable" | "compact";
}) {
  return (
    <span
      className={`${styles.status} ${className ?? ""}`}
      data-density={density}
      data-live-status={status}
      data-live-state={status}
    >
      <span className={styles.dot} aria-hidden="true" />
      {label ?? labels[locale][status]}
    </span>
  );
}
