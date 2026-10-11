import { ArrowRight, TicketCheck } from "lucide-react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanSurface } from "@/components/fan-ui/fan-surface";
import type { AppLocale } from "@/i18n/locales";
import { raffleDiscoveryCopy } from "@/i18n/catalogs/features__benefit__ui__raffle-discovery";
import styles from "./raffle-results-notice.module.css";

export function RaffleResultsNotice({ locale, className = "" }: { locale: AppLocale; className?: string }) {
  const t = raffleDiscoveryCopy[locale];
  return <FanSurface tone="focus" className={`${styles.notice} ${className}`} aria-label={t.announced}>
    <span className={styles.icon} aria-hidden="true"><TicketCheck /></span>
    <div className={styles.copy}><h2>{t.title}</h2><p>{t.description}</p></div>
    <FanAction variant="primary" href={`/my/raffles?locale=${locale}`} trailingIcon={<ArrowRight />}>{t.action}</FanAction>
  </FanSurface>;
}
