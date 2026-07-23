"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronRight } from "./icons";
import { FanCompactHeader } from "./fan-shell/fan-compact-header";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import styles from "./celebrity-directory.module.css";

type PassportRecord = Readonly<{ celebrity?: Readonly<{ slug?: unknown }> }>;
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
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

const copy = {
  ko: { home: "홈으로", heading: "당신의 최애", intro: "ByUs에서 만날 수 있는 공식 셀럽을 둘러보세요.", search: "셀럽 검색", searchPlaceholder: "이름으로 찾아보세요", sort: "정렬", defaultSort: "기본순", nameSort: "이름순", liveSort: "LIVE 예정 우선", passportOnly: "내 Passport만", count: "명의 셀럽", guestFilter: "Passport 보유 필터는 로그인 후 사용할 수 있어요.", loadingPassport: "내 Passport를 확인하고 있어요.", retryPrefix: "내 Passport를 확인하지 못했어요.", retry: "다시 시도", noPublished: "지금 공개된 셀럽이 없어요.", noPublishedHelp: "새로운 최애가 공개되면 이곳에서 바로 만날 수 있어요.", back: "오늘의 LIVE로 돌아가기", ownedEmpty: "보유한 Passport와 일치하는 셀럽이 없어요.", searchEmpty: "검색 결과가 없어요.", ownedHelp: "필터를 해제하면 다른 공식 셀럽도 둘러볼 수 있어요.", searchHelp: "다른 이름으로 검색하거나 필터를 초기화해 보세요.", reset: "필터 초기화", list: "공개 셀럽 목록", owned: "Passport 보유", fanPage: "팬페이지 보기", fanPageMove: "팬페이지로 이동", liveSoon: "LIVE 예정", livePreparing: "다음 LIVE 준비 중" },
  en: { home: "Home", heading: "Find your favorite", intro: "Browse the official celebrities available on ByUs.", search: "Search celebrities", searchPlaceholder: "Search by name", sort: "Sort", defaultSort: "Featured order", nameSort: "Name", liveSort: "Upcoming LIVE first", passportOnly: "My Passports only", count: " celebrities", guestFilter: "Sign in to filter by the Passports you own.", loadingPassport: "Checking your Passports.", retryPrefix: "We couldn't check your Passports.", retry: "Try again", noPublished: "No celebrities are published yet.", noPublishedHelp: "New official celebrities will appear here when published.", back: "Back to today's LIVE", ownedEmpty: "No celebrities match your Passports.", searchEmpty: "No search results.", ownedHelp: "Turn off the filter to browse other official celebrities.", searchHelp: "Try another name or clear the filters.", reset: "Clear filters", list: "Published celebrity list", owned: "Passport owned", fanPage: "fan page", fanPageMove: "open fan page", liveSoon: "LIVE upcoming", livePreparing: "Next LIVE in preparation" },
} as const;

function passportSlugs(value: unknown): ReadonlySet<string> {
  if (!value || typeof value !== "object" || !("passports" in value) || !Array.isArray(value.passports)) {
    throw new Error("Invalid Passport collection");
  }
  return new Set(
    (value.passports as PassportRecord[])
      .map((passport) => passport.celebrity?.slug)
      .filter((slug): slug is string => typeof slug === "string"),
  );
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
    <main className={styles.page}>
      <FanCompactHeader brandAriaLabel={locale === "ko" ? "ByUs 홈" : "ByUs home"} brandHref={`/${localeQuery}` as Route}>
        <Link className={styles.homeLink} href={`/${localeQuery}`}> {t.home} <ChevronRight /></Link>
      </FanCompactHeader>
      <section className={styles.content} aria-labelledby="directory-heading">
        <div className={styles.intro}><h1 id="directory-heading">{t.heading}</h1><p>{t.intro}</p></div>
        {celebrities.length === 0 ? (
          <div className={styles.empty} role="status"><h2>{t.noPublished}</h2><p>{t.noPublishedHelp}</p><Link href={`/${localeQuery}`}>{t.back}</Link></div>
        ) : <>
          <form className={styles.controls} role="search" onSubmit={(event) => event.preventDefault()}>
            <label className={styles.searchField} htmlFor="celebrity-search"><span>{t.search}</span><input id="celebrity-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /></label>
            <label className={styles.sortField} htmlFor="celebrity-sort"><span>{t.sort}</span><select id="celebrity-sort" value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}><option value="published">{t.defaultSort}</option><option value="name-asc">{t.nameSort}</option><option value="live-first">{t.liveSort}</option></select></label>
            <label className={styles.passportFilter} data-disabled={passportFilterDisabled}><input type="checkbox" checked={ownedOnly} disabled={passportFilterDisabled} onChange={(event) => setOwnedOnly(event.target.checked)} /><span>{t.passportOnly}</span></label>
          </form>
          <div className={styles.filterMeta} aria-live="polite">
            <p>{visibleCelebrities.length}{t.count}</p>
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
                  <Link className={styles.media} href={`/c/${celebrity.slug}${localeQuery}`} aria-label={`${celebrity.name} ${t.fanPage}`}>
                    <Image src={celebrity.image.url} alt={celebrity.image.alt} width={640} height={800} style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
                    {ownsPassport ? <span className={styles.passportBadge}>{t.owned}</span> : null}
                  </Link>
                  <div className={styles.cardBody}><div><h2>{celebrity.name}</h2><p>{celebrity.upcomingLive ? `${formatLiveDate(celebrity.upcomingLive.startsAt, locale)} ${t.liveSoon}` : t.livePreparing}</p></div><Link href={`/c/${celebrity.slug}${localeQuery}`} aria-label={`${celebrity.name} ${t.fanPageMove}`}><ArrowRight /></Link></div>
                </article>;
              })}
            </div>
          )}
        </>}
      </section>
    </main>
  );
}
