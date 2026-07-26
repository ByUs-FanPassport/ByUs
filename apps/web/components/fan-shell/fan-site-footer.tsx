import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";

import type { FanLocale } from "./fan-app-shell";
import { FanContentContainer } from "./fan-content-container";
import styles from "./fan-site-footer.module.css";

const copy = {
  ko: {
    tagline: "최애와 함께한 순간을 기록하고, 다음 팬 활동으로 이어가세요.",
    explore: "둘러보기",
    activity: "나의 활동",
    guide: "안내",
    favorites: "최애",
    passports: "Fan Passport",
    benefits: "혜택",
    notifications: "알림",
    privacy: "개인정보처리방침",
    terms: "이용약관",
    nav: "ByUs 하단 메뉴",
  },
  en: {
    tagline: "Keep every moment with your favorite and continue your fan journey.",
    explore: "Explore",
    activity: "My activity",
    guide: "Guide",
    favorites: "Favorites",
    passports: "Fan Passport",
    benefits: "Benefits",
    notifications: "Notifications",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    nav: "ByUs footer navigation",
  },
} as const;

function fanHref(pathname: string, locale: FanLocale): Route {
  return `${pathname}?locale=${locale}` as Route;
}

export function FanSiteFooter({ locale }: { locale: FanLocale }) {
  const t = copy[locale];
  return (
    <footer className={styles.footer} data-fan-site-footer>
      <FanContentContainer className={styles.inner}>
        <div className={styles.brandColumn}>
          <Link className={styles.brand} href={fanHref("/", locale)} aria-label={locale === "ko" ? "ByUs 홈" : "ByUs home"}>
            <Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={96} height={36} />
          </Link>
          <p>{t.tagline}</p>
        </div>

        <nav className={styles.navigation} aria-label={t.nav}>
          <section>
            <h2>{t.explore}</h2>
            <Link href={fanHref("/", locale)}>HOME</Link>
            <Link href={fanHref("/live", locale)}>LIVE</Link>
            <Link href={fanHref("/celebrities", locale)}>{t.favorites}</Link>
          </section>
          <section>
            <h2>{t.activity}</h2>
            <Link href={fanHref("/my", locale)}>MY</Link>
            <Link href={fanHref("/passports", locale)}>{t.passports}</Link>
            <Link href={fanHref("/benefits", locale)}>{t.benefits}</Link>
            <Link href={fanHref("/notifications", locale)}>{t.notifications}</Link>
          </section>
          <section>
            <h2>{t.guide}</h2>
            <Link href="/privacy" aria-label={locale === "ko" ? "개인정보처리방침 열기" : "Open Privacy Policy"}>{t.privacy}</Link>
            <Link href="/terms" aria-label={locale === "ko" ? "이용약관 열기" : "Open Terms of Use"}>{t.terms}</Link>
          </section>
        </nav>
      </FanContentContainer>

      <FanContentContainer className={styles.legal}>
        <span>© 2026 Sallylab Inc.</span>
      </FanContentContainer>
    </footer>
  );
}
