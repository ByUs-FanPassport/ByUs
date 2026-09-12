import type { PublishedCelebrity } from "@/server/content/content-domain";
import { CreatorImage } from "../fan-ui/creator-image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ContentLocale } from "@/server/content/content-domain";
import styles from "./home-entry-cards.module.css";
import { HomeHeroBanner } from "./home-hero-banner";

const copy = {
  ko: {
    title: <>엘리나와 함께 <br />ByUs 참여 가이드</>,
    label: "엘리나와 함께 ByUs 참여 가이드",
    description: "팬 인증부터 선물 응모까지",
    action: "참여 방법 보기",
    fanmeeting: "미국 팬미팅, ByUs와 함께 준비하세요",
    explore: "기획사와 아티스트를 위한 미국 현지 협업",
  },
  en: {
    title: <>Your ByUs guide <br />with Elina</>,
    label: "Your ByUs guide with Elina",
    description: "From fan verification to prize draws",
    action: "See how to join",
    fanmeeting: "Plan your U.S. fanmeeting with ByUs",
    explore: "U.S. event partnerships for agencies and artists",
  },
};

export function ElinaGuideCard({ locale, elina, hero = false, priority = false }: { locale: ContentLocale; elina: PublishedCelebrity | undefined; hero?: boolean; priority?: boolean }) {
  const t = copy[locale];
  const image = elina ? <CreatorImage slug={elina.slug} src="/images/celebrities/elina/guide-blue-beret-20260912.webp" photos={undefined} position="50% 70%" presentation="portrait" locale={locale} alt="" fill priority={priority} sizes={hero ? "(max-width: 767px) calc(100vw - 32px), 40vw" : "154px"} /> : null;
  if (hero) return <HomeHeroBanner image={image} eyebrow="ELINA × BYUS" title={t.title}
    description={t.description}
    action={<Link href={`/pages/elina-fan-guide?locale=${locale}` as Route} aria-label={t.label}><span>{t.action}</span><ArrowRight aria-hidden="true" /></Link>} />;
  return <Link className={styles.guide} href={`/pages/elina-fan-guide?locale=${locale}` as Route} aria-label={t.label}>
    <span className={styles.portrait}>{image}</span>
    <span className={styles.guideCopy}>
      <small>ELINA × BYUS</small>
      <strong>{t.title}</strong>
      <span className={styles.description}>{t.description}</span>
      <span className={styles.action}>{t.action}<ArrowRight size={16} aria-hidden="true" /></span>
    </span>
  </Link>;
}

export function HomeEntryCards({ locale, celebrities }: { locale: ContentLocale; celebrities: readonly PublishedCelebrity[] }) {
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
