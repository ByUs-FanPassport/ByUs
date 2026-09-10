import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ContentLocale } from "@/server/content/content-domain";
import { ifewEventBanner } from "../ifew-fan-guide/content";
import styles from "./home-entry-cards.module.css";

const copy = {
  ko: {
    title: <>엘리나와 함께<br />ByUs 참여 가이드</>,
    label: "엘리나와 함께 ByUs 참여 가이드",
    description: "팬 인증부터 선물 응모까지",
    action: "참여 방법 보기",
    ifewTitle: "이퓨 100일 LIVE 참여 가이드",
    ifewLabel: "이퓨의 틱톡 100일 기념 LIVE 참여 가이드",
    ifewDescription: "9월 12일(토) 오전 8시 · KST",
    fanmeeting: "우리 아티스트의 첫 미국 팬미팅",
    explore: "미국 팬들과의 만남, 시작해 볼까요?",
  },
  en: {
    title: <>Your ByUs guide<br />with Elina</>,
    label: "Your ByUs guide with Elina",
    description: "From fan verification to prize draws",
    action: "See how to join",
    ifewTitle: "ifew’s 100-day LIVE guide",
    ifewLabel: "ifew’s 100-day TikTok LIVE guide",
    ifewDescription: "Sat, Sep 12 · 8 AM KST",
    fanmeeting: "Your artist’s first U.S. fan meeting",
    explore: "Explore the possibilities",
  },
};

export function HomeEntryCards({ locale }: { locale: ContentLocale }) {
  const t = copy[locale];
  return (
    <div className={styles.cards} data-home-entry-cards>
      <Link className={styles.eventGuide} href={`/pages/ifew-fan-guide?locale=${locale}` as Route} aria-label={t.ifewLabel}>
        <Image className={styles.eventBanner} src={ifewEventBanner} alt="" width={1774} height={887} sizes="(max-width: 767px) calc(100vw - 32px), 384px" />
        <span className={styles.eventGuideCopy}>
          <span><strong>{t.ifewTitle}</strong><small>{t.ifewDescription}</small></span>
          <ArrowRight size={18} aria-hidden="true" />
        </span>
      </Link>
      <Link className={styles.guide} href={`/pages/elina-fan-guide?locale=${locale}` as Route} aria-label={t.label}>
        <span className={styles.portrait}><Image src="/images/home-entry/elina.jpg" alt="" fill sizes="154px" /></span>
        <span className={styles.guideCopy}>
          <small>ELINA × BYUS</small>
          <strong>{t.title}</strong>
          <span className={styles.description}>{t.description}</span>
          <span className={styles.action}>{t.action}<ArrowRight size={16} aria-hidden="true" /></span>
        </span>
      </Link>
      <Link className={styles.fanmeeting} href={`/pages/us-fanmeetings?locale=${locale}`} aria-label={t.fanmeeting}>
        <span className={styles.flag} aria-hidden="true"><span>{Array.from({ length: 20 }, (_, i) => <span key={i}>☆</span>)}</span></span>
        <span className={styles.fanmeetingCopy}><strong>{t.fanmeeting}</strong><span>{t.explore}</span></span>
        <span className={styles.arrow}><ArrowUpRight size={16} aria-hidden="true" /></span>
      </Link>
    </div>
  );
}
