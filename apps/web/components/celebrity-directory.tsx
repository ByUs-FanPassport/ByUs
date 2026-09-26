"use client";

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__celebrity-directory";
import { additionalLocales, translate } from "@/i18n/messages";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

import { usePrivy } from "@privy-io/react-auth";
import { LiveStatusIndicator } from "./live-status-indicator";
import { useOwnedFanResource } from "./fan-ui/use-owned-fan-resource";
import { CreatorRoleFilterControl, CreatorRolesText } from "./fan-ui/creator-roles";
import { availableCreatorRoles, matchesCreatorRole, type CreatorRoleFilter } from "@/features/creator/domain/creator-role";
import { CreatorPortrait } from "./fan-ui/creator-portrait";
import { orderCreatorsForDiscovery } from "../server/content/creator-discovery";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { FanAppFrame, FanContentContainer } from "./fan-shell/fan-app-shell";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import { FanStageTooltip } from "../features/rewards/ui/fan-stage-tooltip";
import { parsePassportCollectionResponse, type PassportCollectionResponse } from "../features/passport/domain/passport-collection";
import { fanUtilityCanvasClassName } from "./fan-ui/fan-surface";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import { FanAction } from "./fan-ui/fan-action";
import { Plus } from "lucide-react";
import { FanHeading } from "./fan-ui/fan-heading";
import styles from "./celebrity-directory.module.css";

type PassportState =
  | Readonly<{ status: "guest" | "loading" }>
  | Readonly<{ status: "ready"; passports: ReadonlyMap<string, PassportCollectionResponse["passports"][number]> }>
  | Readonly<{ status: "error" }>;
type SortOrder = "published" | "name-asc" | "live-first";
type DirectoryCelebrity = PublishedCelebrity & Readonly<{ upcomingLive: PublishedCelebrityLive | null }>;

function formatLiveDate(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { calendar: "gregory",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: locale === "ko" ? false : locale === "en" ? true : undefined,
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

const copy = {
  ko: { home: "홈으로", heading: "최애 찾기", intro: "좋아하는 최애를 만나고, 다음 LIVE를 확인하세요.", search: "이름으로 찾기", searchPlaceholder: "이름으로 검색", sort: "정렬", defaultSort: "기본순", nameSort: "이름순", liveSort: "LIVE 우선", guestFilter: "내 최애를 보려면 로그인해 주세요.", signIn: "로그인하기", loadingPassport: "보유한 Fan Passport를 확인하고 있어요.", retryPrefix: "보유한 Fan Passport를 확인하지 못했어요.", retry: "다시 시도", noPublished: "지금 공개된 셀럽이 없어요.", noPublishedHelp: "새로운 셀럽이 공개되면 이곳에서 바로 만날 수 있어요.", back: "LIVE 둘러보기", ownedEmpty: "아직 보유한 Fan Passport가 없어요.", searchEmpty: "검색 결과가 없어요.", ownedHelp: "전체 최애를 둘러보고 Fan Passport를 만들어 보세요.", discoverAll: "전체 보기", searchHelp: "다른 이름으로 검색하거나 필터를 초기화해 보세요.", reset: "필터 초기화", list: "최애 목록", owned: "패스포트 보유", fanPage: "만나보기", fanPageMove: "팬페이지로 이동", liveSoon: "LIVE 예정", livePreparing: "예정된 LIVE가 없어요." },
  en: { home: "Home", heading: "Find your favorite", intro: "Explore your favorites’ LIVE events and fan pages.", search: "Search celebrities", searchPlaceholder: "Search by name", sort: "Sort", defaultSort: "Default", nameSort: "Name", liveSort: "LIVE first", guestFilter: "Sign in to see your favorites.", signIn: "Sign in", loadingPassport: "Loading your Fan Passports.", retryPrefix: "We couldn't load your Fan Passports.", retry: "Try again", noPublished: "No profiles are available yet.", noPublishedHelp: "New profiles will appear here when they’re available.", back: "Explore LIVE events", ownedEmpty: "You don't own a Fan Passport yet.", searchEmpty: "No search results.", ownedHelp: "Browse all favorites and create a Fan Passport.", discoverAll: "View all", searchHelp: "Try another name or clear the filters.", reset: "Clear filters", list: "Celebrities and creators", owned: "With a Fan Passport", fanPage: "View fan page", fanPageMove: "open fan page", liveSoon: "Upcoming LIVE", livePreparing: "No upcoming LIVE events." },

  ...additionalLocales((translationLocale) => ({ home: localizedMessages.mda6909bdf841[translationLocale], heading: localizedMessages.mab373172560f[translationLocale], intro: localizedMessages.maf7baaeb1247[translationLocale], search: localizedMessages.m9e8df343175e[translationLocale], searchPlaceholder: localizedMessages.mc64d8e801119[translationLocale], sort: localizedMessages.m025626c0e4cd[translationLocale], defaultSort: localizedMessages.m2c77fa082979[translationLocale], nameSort: localizedMessages.m3a9719ad7ac1[translationLocale], liveSort: localizedMessages.m54b70197c3c1[translationLocale], guestFilter: localizedMessages.mc875440f4085[translationLocale], signIn: localizedMessages.m58cff46ab67f[translationLocale], loadingPassport: localizedMessages.mbed47a1091b0[translationLocale], retryPrefix: localizedMessages.m8261b7a0bdb7[translationLocale], retry: localizedMessages.m9f6ac5f4882d[translationLocale], noPublished: localizedMessages.m7a9a0aa09f21[translationLocale], noPublishedHelp: localizedMessages.md7f058ad3092[translationLocale], back: localizedMessages.m6583b95908cf[translationLocale], ownedEmpty: localizedMessages.m306505f6ba01[translationLocale], searchEmpty: localizedMessages.m17edf81f334e[translationLocale], ownedHelp: localizedMessages.me4d7e93c8b8f[translationLocale], discoverAll: localizedMessages.m73e0c60f172a[translationLocale], searchHelp: localizedMessages.m6a76b31b262c[translationLocale], reset: localizedMessages.m90e01a3bc89a[translationLocale], list: localizedMessages.m0a48aa274797[translationLocale], owned: localizedMessages.m740f37c456f4[translationLocale], fanPage: localizedMessages.m1e780ecb9a9b[translationLocale], fanPageMove: localizedMessages.m467b7a8a93a1[translationLocale], liveSoon: localizedMessages.md17036c0cfa4[translationLocale], livePreparing: localizedMessages.m85d27e25d314[translationLocale] }))
} as const;

function passportsBySlug(value: unknown) {
  return new Map(parsePassportCollectionResponse(value).passports.map((passport) => [passport.celebrity.slug, passport]));
}

/** Directory copy ends at a complete published sentence, never a visual ellipsis. */
export function directoryIntroduction(summary: string, locale: AppLocale) {
  const sentences = new Intl.Segmenter(locale, { granularity: "sentence" }).segment(summary.trim());
  return Array.from(sentences)[0]?.segment.trim() ?? "";
}

export function CelebrityDirectory({ celebrities, locale, initialQuery = "", initialSort = "published", initialOwnedOnly, initialRole = "all" }: { celebrities: readonly DirectoryCelebrity[]; locale: AppLocale; initialQuery?: string; initialSort?: SortOrder; initialOwnedOnly?: boolean; initialRole?: CreatorRoleFilter }) {
  const t = copy[locale], discovery = discoveryCopy(locale);
  const localeQuery = `?locale=${locale}`;
  const auth = usePrivy();
  const router = useRouter();
  const { ready, authenticated } = auth;
  const [query, setQuery] = useState(initialQuery);
  const requestHref = `/bias/requests?locale=${locale}${query.trim() ? `&name=${encodeURIComponent(query.trim().slice(0, 120))}` : ""}`;
  const [role, setRole] = useState<CreatorRoleFilter>(initialOwnedOnly ? "all" : initialRole);
  const [sort, setSort] = useState<SortOrder>(initialSort);
  const [ownedOnlyOverride, setOwnedOnly] = useState(initialOwnedOnly);
  const { state, retry } = useOwnedFanResource(`/api/passports?locale=${toContentLocale(locale)}&tierStages=1`, passportsBySlug, auth);
  const passportState = useMemo<PassportState>(() => ready && !authenticated ? { status: "guest" }
    : state.status === "ready" ? { status: "ready", passports: state.data }
    : { status: state.status }, [ready, authenticated, state]);
  const hasOwnedPassport = passportState.status === "ready" && passportState.passports.size > 0;
  const ownedOnly = ownedOnlyOverride ?? (role === "all" && hasOwnedPassport);
  // Resolve auth, ownership badges, ordering and the default filter before revealing results.
  const isDirectoryLoading = passportState.status === "loading";

  const visibleCelebrities = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    const ownedSlugs = passportState.status === "ready" ? passportState.passports : new Set<string>();
    const filtered = celebrities.filter((celebrity) => {
      const matchesQuery = !normalized || celebrity.name.toLocaleLowerCase("ko-KR").includes(normalized);
      return matchesQuery && matchesCreatorRole(celebrity.roles, role) && (!ownedOnly || (passportState.status === "ready" && ownedSlugs.has(celebrity.slug)));
    });
    if (sort === "name-asc") {
      return filtered.toSorted((left, right) => left.name.localeCompare(right.name, locale));
    }
    if (sort === "live-first") {
      return filtered.toSorted((left, right) => Number(Boolean(right.upcomingLive)) - Number(Boolean(left.upcomingLive)));
    }
    return orderCreatorsForDiscovery(filtered).toSorted((left, right) =>
      Number(ownedSlugs.has(right.slug)) - Number(ownedSlugs.has(left.slug)),
    );
  }, [celebrities, locale, ownedOnly, passportState, query, sort, role]);

  const loginReturnQuery = new URLSearchParams({ locale, owned: "1", q: query, sort });
  const passportLoginHref = `/login?${new URLSearchParams({ locale, returnTo: `/celebrities?${loginReturnQuery}` })}` as Route;
  const filtersActive = query.trim().length > 0 || ownedOnly || role !== "all";

  const replaceFilterUrl = (next: { ownedOnly: boolean; role: CreatorRoleFilter; query: string; sort: SortOrder }) => {
    const url = new URL(window.location.href);
    if (next.ownedOnly) url.searchParams.set("owned", "1");
    else url.searchParams.delete("owned");
    if (!next.ownedOnly) url.searchParams.set("role", next.role);
    else url.searchParams.delete("role");
    if (next.query.trim()) url.searchParams.set("q", next.query);
    else url.searchParams.delete("q");
    if (next.sort !== "published") url.searchParams.set("sort", next.sort);
    else url.searchParams.delete("sort");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const changeRole = (nextRole: CreatorRoleFilter, clearFilters = false) => {
    setRole(nextRole);
    setOwnedOnly(false);
    if (clearFilters) {
      setQuery("");
    }
    replaceFilterUrl({ ownedOnly: false, role: nextRole, query: clearFilters ? "" : query, sort });
  };

  const selectOwned = () => {
    if (!ready || !authenticated) {
      router.push(passportLoginHref);
      return;
    }
    setOwnedOnly(true);
    setRole("all");
    replaceFilterUrl({ ownedOnly: true, role: "all", query, sort });
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setOwnedOnly(ownedOnly);
    replaceFilterUrl({ ownedOnly, role, query: nextQuery, sort });
  };

  const changeSort = (nextSort: SortOrder) => {
    setSort(nextSort);
    setOwnedOnly(ownedOnly);
    replaceFilterUrl({ ownedOnly, role, query, sort: nextSort });
  };

  const renderCreator = (celebrity: DirectoryCelebrity) => {
    const passport = passportState.status === "ready" ? passportState.passports.get(celebrity.slug) : undefined;
    return (<article key={celebrity.slug} className={styles.card} data-passport-owned={passport ? "true" : undefined}>
                  <Link className={styles.cardLink} href={`${creatorHomeHref(celebrity.slug)}${localeQuery}`} aria-label={locale === "ko" ? `${celebrity.name} ${t.fanPage}` : translate(locale, localizedMessages.m11a1d75c5b58, "View {0}’s fan page", [celebrity.name])}>
                  <div className={styles.cardPrimary}>
                    <div className={styles.cardIdentity}>
                      <h2>{celebrity.name}</h2>
                      <CreatorRolesText roles={celebrity.roles} locale={locale} />
                    </div>
                    {celebrity.upcomingLive ? <p className={styles.liveSchedule}>
                      <LiveStatusIndicator status={celebrity.upcomingLive.effectiveStatus === "live" ? "live" : "scheduled"} locale={locale} density="compact" />
                      <time dateTime={celebrity.upcomingLive.startsAt}>{formatLiveDate(celebrity.upcomingLive.startsAt, locale)}</time>
                    </p> : null}
                  </div>
                  <div className={styles.media}>
                    <CreatorPortrait locale={locale} slug={celebrity.slug} image={celebrity.image} variant="full-bleed" />
                    {passport ? <span className={styles.passportBadge}><span aria-hidden="true">✓</span>{t.owned}</span> : null}
                  </div>
                  <div className={styles.cardBody}><p className={styles.creatorSummary}>{directoryIntroduction(celebrity.summary, locale)}</p></div></Link>
                  {passport ? <FanStageTooltip
                    className={styles.passportStage}
                    celebrityName={celebrity.name}
                    tier={passport.score.level}
                    points={passport.score.points}
                    stageProgress={passport.score.stageProgress}
                    locale={locale}
                  /> : null}
                </article>);
  };

  return (
    <FanAppFrame locale={locale} className={fanUtilityCanvasClassName} mainId="celebrity-directory-content">
    <FanContentContainer as="main" className={styles.page} id="celebrity-directory-content" tabIndex={-1}>
      <section className={styles.content} aria-labelledby="directory-heading">
        <div className={styles.introRow}><div className={styles.intro}><FanHeading as="h1" id="directory-heading" variant="personal-page">{t.heading}</FanHeading><p>{t.intro}</p></div><FanAction href={requestHref} leadingIcon={<Plus />} variant="neutral">{discovery.requestFavorite}</FanAction></div>
        {celebrities.length === 0 ? (
          <div className={styles.empty} role="status"><h2>{t.noPublished}</h2><p>{t.noPublishedHelp}</p><Link href={`/${localeQuery}`}>{t.back}</Link></div>
        ) : isDirectoryLoading ? (
          <div role="status" aria-label={t.loadingPassport} aria-busy="true">
            <span className={styles.srOnly}>{t.loadingPassport}</span>
            <div aria-hidden="true">
              <div className={styles.skeletonFilters}>{Array.from({ length: 4 }, (_, index) => <span key={index} className={`${styles.skeletonBlock} ${styles.skeletonChip}`} />)}</div>
              <div className={styles.controls}>{[0, 1].map(index => <div key={index} className={styles.searchField}><span className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} /><span className={`${styles.skeletonBlock} ${styles.skeletonInput}`} /></div>)}</div>
              <div className={styles.filterMeta}><span className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} /></div>
              <div className={styles.grid}>{Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.card}>
                  <div className={styles.cardLink}>
                    <div className={styles.cardPrimary}><div className={styles.cardIdentity}><span className={`${styles.skeletonBlock} ${styles.skeletonTitle}`} /><span className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} /></div></div>
                    <div className={`${styles.media} ${styles.skeletonBlock}`} />
                    <div className={styles.cardBody}><span className={`${styles.skeletonBlock} ${styles.skeletonSummary}`} /></div>
                  </div>
                </div>
              ))}</div>
            </div>
          </div>
        ) : <>
          <CreatorRoleFilterControl roles={availableCreatorRoles(celebrities)} value={role} onChange={changeRole} locale={locale} controls="directory-results" ownedOnly={ownedOnly} onSelectOwned={selectOwned} compact />
          <form className={styles.controls} role="search" onSubmit={(event) => event.preventDefault()}>
            <label className={styles.searchField} htmlFor="celebrity-search"><span>{t.search}</span><span className={styles.inputControl}><input id="celebrity-search" type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder={t.searchPlaceholder} /></span></label>
            <label className={styles.sortField} htmlFor="celebrity-sort"><span>{t.sort}</span><span className={styles.selectControl}><select id="celebrity-sort" value={sort} onChange={(event) => changeSort(event.target.value as SortOrder)}><option value="published">{t.defaultSort}</option><option value="name-asc">{t.nameSort}</option><option value="live-first">{t.liveSort}</option></select><ChevronDown aria-hidden="true" /></span></label>
          </form>
          <div className={styles.filterMeta} aria-live="polite">
            {!ownedOnly || passportState.status === "ready" ? <p>{locale === "ko" ? `총 ${visibleCelebrities.length}개` : translate(locale, localizedMessages.m2755e20a87be, "{0} profiles", [visibleCelebrities.length])}</p> : null}
          </div>
          {ownedOnly && passportState.status === "guest" ? (
            <div id="directory-results" className={styles.ownedState} role="status"><p>{t.guestFilter}</p><Link href={passportLoginHref}>{t.signIn}</Link></div>
          ) : ownedOnly && passportState.status === "error" ? (
            <div id="directory-results" className={styles.ownedState} role="alert"><p>{t.retryPrefix}</p><button type="button" onClick={retry}>{t.retry}</button></div>
          ) : visibleCelebrities.length === 0 ? (
            <div id="directory-results" className={styles.empty} role="status"><h2>{ownedOnly && !hasOwnedPassport ? t.ownedEmpty : t.searchEmpty}</h2><p>{ownedOnly && !hasOwnedPassport ? t.ownedHelp : t.searchHelp}</p>{ownedOnly && !hasOwnedPassport ? <button type="button" onClick={() => changeRole("all")}>{t.discoverAll}</button> : filtersActive ? <button type="button" onClick={() => changeRole("all", true)}>{t.reset}</button> : null}{!ownedOnly && <div className={styles.requestEmpty}><p>{discovery.missingFavorite}</p><FanAction href={requestHref} variant="neutral" leadingIcon={<Plus />}>{discovery.requestFavorite}</FanAction></div>}</div>
          ) : (
            <div id="directory-results" className={styles.grid} aria-label={t.list}>
              {visibleCelebrities.map(c => renderCreator(c))}
            </div>
          )}
        </>}
      </section>
    </FanContentContainer>
    </FanAppFrame>
  );
}
