import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";

import type { FanLocale } from "./fan-app-shell";
import { FanContentContainer } from "./fan-content-container";
import styles from "./fan-site-footer.module.css";

const TELEGRAM_CHANNEL_URL = "https://t.me/ByUs_official";

// Brand marks from Simple Icons; Instagram reuses our existing local mark.
const SOCIAL_CHANNELS = [
  {
    "name": "Instagram",
    "labelKo": "인스타그램",
    "url": "https://www.instagram.com/official_byus/",
    "path": "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"
  },
  {
    "name": "X",
    "labelKo": "X",
    "url": "https://x.com/official_byus",
    "path": "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
  },
  {
    "name": "Threads",
    "labelKo": "쓰레드",
    "url": "https://www.threads.com/@official_byus",
    "path": "M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z"
  }
] as const;

const copy = {
  ko: {
    tagline: "최애와 함께한 순간을 기록하는 곳.",
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
    fanmeetings: "팬미팅 협업 문의",
    serviceGuide: "이용 가이드",
    creatorOnboarding: "팬이 있는 당신에게",
    partners: "파트너 협업 제안",
  },
  en: {
    tagline: "A place to record moments with your favorite.",
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
    fanmeetings: "Fan meeting partnerships",
    serviceGuide: "Service guide",
    creatorOnboarding: "For everyone with fans",
    partners: "Partnership proposals",
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
            <Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={96} height={39} />
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
            <Link href={fanHref("/guide", locale)}>{t.serviceGuide}</Link>
            <Link href={fanHref("/pages/us-fanmeetings", locale)}>{t.fanmeetings}</Link>
            <Link href={fanHref("/pages/creator-onboarding", locale)}>{t.creatorOnboarding}</Link>
            <Link href={fanHref("/pages/partners", locale)}>{t.partners}</Link>
            <Link href={fanHref("/privacy", locale)} aria-label={locale === "ko" ? "개인정보처리방침 열기" : "Open Privacy Policy"}>{t.privacy}</Link>
            <Link href={fanHref("/terms", locale)} aria-label={locale === "ko" ? "이용약관 열기" : "Open Terms of Use"}>{t.terms}</Link>
          </section>
          <section>
            <h2>{t.social}</h2>
            <div className={styles.socialLinks}>
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
              {SOCIAL_CHANNELS.map((channel) => (
                <a
                  key={channel.name}
                  className={styles.socialLink}
                  href={channel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={locale === "ko" ? channel.labelKo : channel.name}
                  aria-label={locale === "ko" ? `ByUs ${channel.labelKo} 열기, 새 창` : `Open ByUs ${channel.name}, new window`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d={channel.path} />
                  </svg>
                </a>
              ))}
            </div>
          </section>
        </nav>
      </FanContentContainer>

      <FanContentContainer className={styles.legal}>
        <span>© 2026 ByUs. All rights reserved.</span>
      </FanContentContainer>
    </footer>
  );
}
