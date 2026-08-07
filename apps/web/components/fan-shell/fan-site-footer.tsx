import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";

import type { FanLocale } from "./fan-app-shell";
import { FanContentContainer } from "./fan-content-container";
import styles from "./fan-site-footer.module.css";

const TELEGRAM_CHANNEL_URL = "https://t.me/ByUs_giwa";

const copy = {
  ko: {
    tagline: "최애와 함께한 순간을 기록하고, 다음 팬 활동으로 이어가세요.",
    explore: "둘러보기",
    activity: "나의 활동",
    guide: "안내",
    social: "소셜",
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
    social: "Social",
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
            <Link href={fanHref("/privacy", locale)} aria-label={locale === "ko" ? "개인정보처리방침 열기" : "Open Privacy Policy"}>{t.privacy}</Link>
            <Link href={fanHref("/terms", locale)} aria-label={locale === "ko" ? "이용약관 열기" : "Open Terms of Use"}>{t.terms}</Link>
          </section>
          <section>
            <h2>{t.social}</h2>
            <a
              className={styles.socialLink}
              href={TELEGRAM_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={locale === "ko" ? "ByUs Telegram 채널 열기, 새 창" : "Open ByUs Telegram channel, new window"}
            >
              <svg viewBox="24 38 72 60" aria-hidden="true">
                <path fill="currentColor" d="M28.9700376,63.3244248 C47.6273373,55.1957357 60.0684594,49.8368063 66.2934036,47.2476366 C84.0668845,39.855031 87.7600616,38.5708563 90.1672227,38.528 C90.6966555,38.5191258 91.8804274,38.6503351 92.6472251,39.2725385 C93.294694,39.7979149 93.4728387,40.5076237 93.5580865,41.0057381 C93.6433345,41.5038525 93.7494885,42.63857 93.6651041,43.5252052 C92.7019529,53.6451182 88.5344133,78.2034783 86.4142057,89.5379542 C85.5170662,94.3339958 83.750571,95.9420841 82.0403991,96.0994568 C78.3237996,96.4414641 75.5015827,93.6432685 71.9018743,91.2836143 C66.2690414,87.5912212 63.0868492,85.2926952 57.6192095,81.6896017 C51.3004058,77.5256038 55.3966232,75.2369981 58.9976911,71.4967761 C59.9401076,70.5179421 76.3155302,55.6232293 76.6324771,54.2720454 C76.6721165,54.1030573 76.7089039,53.4731496 76.3346867,53.1405352 C75.9604695,52.8079208 75.4081573,52.921662 75.0095933,53.0121213 C74.444641,53.1403447 65.4461175,59.0880351 48.0140228,70.8551922 C45.4598218,72.6091037 43.1463059,73.4636682 41.0734751,73.4188859 C38.7883453,73.3695169 34.3926725,72.1268388 31.1249416,71.0646282 C27.1169366,69.7617838 23.931454,69.0729605 24.208838,66.8603276 C24.3533167,65.7078514 25.9403832,64.5292172 28.9700376,63.3244248 Z" />
              </svg>
            </a>
          </section>
        </nav>
      </FanContentContainer>

      <FanContentContainer className={styles.legal}>
        <span>© 2026 Sallylab Inc.</span>
      </FanContentContainer>
    </footer>
  );
}
