"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "./icons";
import { FanAppFrame, FanContentContainer } from "./fan-shell/fan-app-shell";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import { parsePassportCollectionResponse } from "../features/passport/domain/passport-collection";
import { fanUtilityCanvasClassName } from "./fan-ui/fan-surface";
import { FanHeading } from "./fan-ui/fan-heading";
import styles from "./celebrity-directory.module.css";

type PassportState =
  | Readonly<{ status: "guest" | "loading" }>
  | Readonly<{ status: "ready"; slugs: ReadonlySet<string> }>
  | Readonly<{ status: "error" }>;
type SortOrder = "published" | "name-asc" | "live-first";
type DirectoryCelebrity = PublishedCelebrity & Readonly<{ upcomingLive: PublishedCelebrityLive | null }>;

function formatLiveDate(value: string, locale: ContentLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: locale !== "ko",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

const copy = {
  ko: { home: "홈으로", heading: "최애 찾기", intro: "좋아하는 크리에이터의 LIVE와 팬페이지를 만나보세요.", search: "이름으로 찾기", searchPlaceholder: "이름으로 검색", sort: "정렬", defaultSort: "기본순", nameSort: "이름순", liveSort: "LIVE 예정 우선", passportOnly: "내 패스포트만", count: "명의 셀럽", guestFilter: "내 패스포트만 보려면 로그인해 주세요.", loadingPassport: "내 패스포트를 확인하고 있어요.", retryPrefix: "내 패스포트를 확인하지 못했어요.", retry: "다시 시도", noPublished: "지금 공개된 셀럽이 없어요.", noPublishedHelp: "새로운 셀럽이 공개되면 이곳에서 바로 만날 수 있어요.", back: "LIVE 둘러보기", ownedEmpty: "내 패스포트와 일치하는 셀럽이 없어요.", searchEmpty: "검색 결과가 없어요.", ownedHelp: "필터를 해제하면 다른 크리에이터도 볼 수 있어요.", searchHelp: "다른 이름으로 검색하거나 필터를 초기화해 보세요.", reset: "필터 초기화", list: "크리에이터 목록", owned: "패스포트 보유", fanPage: "팬페이지 보기", fanPageMove: "팬페이지로 이동", liveSoon: "LIVE 예정", livePreparing: "예정된 LIVE가 없어요." },
  en: { home: "Home", heading: "Find your favorite", intro: "Explore creators’ LIVE events and fan pages.", search: "Search celebrities", searchPlaceholder: "Search by name", sort: "Sort", defaultSort: "Default order", nameSort: "Name", liveSort: "Upcoming LIVE first", passportOnly: "My Passports only", count: " celebrities", guestFilter: "Sign in to filter by the Passports you own.", loadingPassport: "Checking your Passports.", retryPrefix: "We couldn't check your Passports.", retry: "Try again", noPublished: "No celebrities are published yet.", noPublishedHelp: "New creators will appear here when published.", back: "Back to today's LIVE", ownedEmpty: "No celebrities match your Passports.", searchEmpty: "No search results.", ownedHelp: "Turn off the filter to browse other creators.", searchHelp: "Try another name or clear the filters.", reset: "Clear filters", list: "Published celebrity list", owned: "Passport owned", fanPage: "fan page", fanPageMove: "open fan page", liveSoon: "LIVE upcoming", livePreparing: "No LIVE scheduled." },
} as const;

function passportSlugs(value: unknown): ReadonlySet<string> {
  return new Set(parsePassportCollectionResponse(value).passports.map((passport) => passport.celebrity.slug));
}

export function CelebrityDirectory({ celebrities, locale }: { celebrities: readonly DirectoryCelebrity[]; locale: ContentLocale }) {
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("published");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const [passportState, setPassportState] = useState<PassportState>({ status: "loading" });

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setPassportState({ status: "guest" });
      setOwnedOnly(false);
      return;
    }
    const controller = new AbortController();
    setPassportState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Missing access token");
        const response = await fetch(`/api/passports?locale=${locale}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Passport request failed");
        setPassportState({ status: "ready", slugs: passportSlugs(await response.json()) });
      } catch {
        if (!controller.signal.aborted) setPassportState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [authenticated, getAccessToken, locale, ready, requestKey]);

  const visibleCelebrities = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    const ownedSlugs = passportState.status === "ready" ? passportState.slugs : new Set<string>();
    const filtered = celebrities.filter((celebrity) => {
      const matchesQuery = !normalized || celebrity.name.toLocaleLowerCase("ko-KR").includes(normalized);
      return matchesQuery && (!ownedOnly || ownedSlugs.has(celebrity.slug));
    });
    if (sort === "name-asc") {
      return filtered.toSorted((left, right) => left.name.localeCompare(right.name, locale));
    }
    if (sort === "live-first") {
      return filtered.toSorted((left, right) => Number(Boolean(right.upcomingLive)) - Number(Boolean(left.upcomingLive)));
    }
    return filtered;
  }, [celebrities, locale, ownedOnly, passportState, query, sort]);

  const filtersActive = query.trim().length > 0 || ownedOnly;
  const passportFilterDisabled = passportState.status !== "ready";

  return (
    <FanAppFrame locale={locale} className={fanUtilityCanvasClassName} mainId="celebrity-directory-content">
    <FanContentContainer as="main" className={styles.page} id="celebrity-directory-content" tabIndex={-1}>
      <section className={styles.content} aria-labelledby="directory-heading">
        <div className={styles.intro}><FanHeading as="h1" id="directory-heading" variant="personal-page">{t.heading}</FanHeading><p>{t.intro}</p></div>
        {celebrities.length === 0 ? (
          <div className={styles.empty} role="status"><h2>{t.noPublished}</h2><p>{t.noPublishedHelp}</p><Link href={`/${localeQuery}`}>{t.back}</Link></div>
        ) : <>
          <form className={styles.controls} role="search" onSubmit={(event) => event.preventDefault()}>
            <label className={styles.searchField} htmlFor="celebrity-search"><span>{t.search}</span><input id="celebrity-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /></label>
            <label className={styles.sortField} htmlFor="celebrity-sort"><span>{t.sort}</span><select id="celebrity-sort" value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}><option value="published">{t.defaultSort}</option><option value="name-asc">{t.nameSort}</option><option value="live-first">{t.liveSort}</option></select></label>
            <label className={styles.passportFilter} data-disabled={passportFilterDisabled}><input type="checkbox" checked={ownedOnly} disabled={passportFilterDisabled} onChange={(event) => setOwnedOnly(event.target.checked)} /><span>{t.passportOnly}</span></label>
          </form>
          <div className={styles.filterMeta} aria-live="polite">
            <p>{locale === "ko" ? `크리에이터 ${visibleCelebrities.length}명` : `${visibleCelebrities.length} creators`}</p>
            {passportState.status === "guest" ? <p>{t.guestFilter}</p> : null}
            {passportState.status === "loading" ? <p role="status">{t.loadingPassport}</p> : null}
            {passportState.status === "error" ? <p role="alert">{t.retryPrefix} <button type="button" onClick={() => setRequestKey((key) => key + 1)}>{t.retry}</button></p> : null}
          </div>
          {visibleCelebrities.length === 0 ? (
            <div className={styles.empty} role="status"><h2>{ownedOnly ? t.ownedEmpty : t.searchEmpty}</h2><p>{ownedOnly ? t.ownedHelp : t.searchHelp}</p>{filtersActive ? <button type="button" onClick={() => { setQuery(""); setOwnedOnly(false); }}>{t.reset}</button> : null}</div>
          ) : (
            <div className={styles.grid} aria-label={t.list}>
              {visibleCelebrities.map((celebrity) => {
                const ownsPassport = passportState.status === "ready" && passportState.slugs.has(celebrity.slug);
                return <article className={styles.card} key={celebrity.slug}>
                  <div className={styles.media}>
                    <Image src={celebrity.image.url} alt={celebrity.image.alt} width={640} height={800} style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
                    {ownsPassport ? <span className={styles.passportBadge}><span aria-hidden="true">✓</span>{t.owned}</span> : null}
                  </div>
                  <div className={styles.cardBody}><div><h2>{celebrity.name}</h2><p className={styles.creatorSummary}>{celebrity.summary}</p><p><span className={styles.statusDot} data-live={Boolean(celebrity.upcomingLive)} aria-hidden="true" />{celebrity.upcomingLive ? `${formatLiveDate(celebrity.upcomingLive.startsAt, locale)} · ${celebrity.upcomingLive.effectiveStatus === "live" ? (locale === "ko" ? "LIVE 진행 중" : "LIVE now") : t.liveSoon}` : t.livePreparing}</p></div><Link href={`/c/${celebrity.slug}${localeQuery}`} aria-label={`${celebrity.name} ${t.fanPage}`}><span>{locale === "ko" ? t.fanPage : "View fan page"}</span><ArrowRight aria-hidden="true" /></Link></div>
                </article>;
              })}
            </div>
          )}
        </>}
      </section>
    </FanContentContainer>
    </FanAppFrame>
  );
}
