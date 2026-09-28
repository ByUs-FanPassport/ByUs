import type { RaffleList } from "@/features/benefit/domain/raffle";
import { formatRaffleDateTime } from "@/features/benefit/ui/benefit-presentation";
import { messages as raffleMessages } from "@/i18n/catalogs/features__benefit__ui__creator-raffles-screen";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__home-entry-cards__home-entry-cards";
import { additionalLocales, translate } from "@/i18n/messages";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { CreatorImage } from "../fan-ui/creator-image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ContentLocale } from "@/server/content/content-domain";
import styles from "./home-entry-cards.module.css";
import { HomeHeroBanner } from "./home-hero-banner";
import { elinaRafflesHref } from "@/features/live/domain/elina-event";

const copy = {
  ko: {
    title: <>엘리나와 함께 <br />뱅크시 전시 보러 가요</>,
    label: "엘리나와 함께 뱅크시 전시 보러 가요",
    description: "팬 인증하고 응모권을 받아 원하는 선물에 응모하세요.",
    action: "이벤트 응모하기",
    fanmeeting: "미국 팬미팅, ByUs와 함께 준비하세요",
    explore: "기획사와 아티스트를 위한 미국 현지 협업",
  },
  en: {
    title: <>See Banksy <br />with Elina</>,
    label: "See Banksy with Elina",
    description: "Verify fandom, get tickets, and enter for a prize.",
    action: "Enter the raffle",
    fanmeeting: "Plan your U.S. fanmeeting with ByUs",
    explore: "U.S. event partnerships for agencies and artists",
  },

  ...additionalLocales((translationLocale) => ({
    title: localizedMessages.ma1bde353710b[translationLocale],
    label: localizedMessages.ma1bde353710b[translationLocale],
    description: localizedMessages.m8730562b9dee[translationLocale],
    action: localizedMessages.m874196adc5ca[translationLocale],
    fanmeeting: localizedMessages.m16b2e3b23b97[translationLocale],
    explore: localizedMessages.mb8abbbaa625c[translationLocale],
  }))
};

export function ElinaGuideCard({ locale, elina, hero = false, priority = false, raffles = [] }: { locale: AppLocale; elina: PublishedCelebrity | undefined; hero?: boolean; priority?: boolean; raffles?: RaffleList["raffles"] }) {
  const t = copy[locale];
  const openRaffles = raffles.filter(raffle => raffle.status === "open");
  const deadline = openRaffles[0]?.entryClosesAt;
  const sharedDeadline = deadline && openRaffles.every(raffle => raffle.entryClosesAt !== null && Date.parse(raffle.entryClosesAt) === Date.parse(deadline));
  const deadlineLabel = locale === "ko" ? "응모 마감" : translate(locale, raffleMessages.mf485736216cc, "Entry deadline");
  // Official image: instagram.com/elina_4_22/p/DdjT4dtk_A1/ (2026-09-21), first carousel photo.
  const image = elina ? <CreatorImage slug={elina.slug} src="/images/celebrities/elina/guide-autumn-20260921.jpg" photos={undefined} position="50% 35%" presentation="portrait" locale={locale} alt="" fill priority={priority} sizes={hero ? "(max-width: 767px) calc(100vw - 32px), 40vw" : "154px"} /> : null;
  if (hero) return <HomeHeroBanner image={image} eyebrow="ELINA × BANKSY" title={t.title}
    description={<>
      {openRaffles.length > 0 ? <>
        <strong className={styles.heroPrizes}>{openRaffles.map(raffle => `${raffle.title} · ${locale === "ko" ? `${raffle.winnerQuantity}명 추첨` : translate(locale, raffleMessages.m6ad6cdce1138, "{0} winners", [raffle.winnerQuantity])}`).join(" · ")}</strong>
        <span className={styles.heroDeadline}>{deadlineLabel} · {sharedDeadline ? <time dateTime={deadline}>{formatRaffleDateTime(deadline, locale)}</time> : locale === "ko" ? "경품별 확인" : translate(locale, raffleMessages.mcd57c1a36622, "View details")}</span>
      </> : null}
      <span>{t.description}</span>
    </>}
    action={<Link href={elinaRafflesHref(locale)} aria-label={t.label}><span>{t.action}</span><ArrowRight aria-hidden="true" /></Link>} />;
  return <Link className={styles.guide} href={elinaRafflesHref(locale)} aria-label={t.label}>
    <span className={styles.portrait}>{image}</span>
    <span className={styles.guideCopy}>
      <small>ELINA × BANKSY</small>
      <strong>{t.title}</strong>
      <span className={styles.description}>{t.description}</span>
      <span className={styles.action}>{t.action}<ArrowRight size={16} aria-hidden="true" /></span>
    </span>
  </Link>;
}

export function HomeEntryCards({ locale, celebrities }: { locale: AppLocale; celebrities: readonly PublishedCelebrity[] }) {
  const t = copy[locale];
  const elina = celebrities.find(celebrity => celebrity.slug === "elina");
  return (
    <div className={styles.cards} data-home-entry-cards>
      <ElinaGuideCard locale={locale} elina={elina} />
      <Link className={styles.fanmeeting} href={`/pages/us-fanmeetings?locale=${locale}`} aria-label={t.fanmeeting}>
        <span className={styles.flag} aria-hidden="true"><span>{Array.from({ length: 20 }, (_, i) => <span key={i}>☆</span>)}</span></span>
        <span className={styles.fanmeetingCopy}><strong>{t.fanmeeting}</strong><span>{t.explore}</span></span>
        <span className={styles.arrow}><ArrowUpRight size={16} aria-hidden="true" /></span>
      </Link>
    </div>
  );
}
