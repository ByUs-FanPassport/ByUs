"use client";
import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__certification__ui__certification-panel";
import { additionalLocales, translate } from "@/i18n/messages";
import { usePrivy } from "@privy-io/react-auth";
import {
  Award,
  BadgeCheck,
  Camera,
  ChevronRight,
  Clock3,
  Crown,
  History,
  Play,
  Sparkles,
  Ticket,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
} from "react";
import { z } from "zod";
import {
  certificationListItemSchema,
  historyItemSchema,
  membershipPlatformLabel,
  type CertificationHistoryItem,
  type CertificationListItem,
  type CertificationLocale,
} from "../domain/certification";
import styles from "./certification.module.css";

const copy = {
  ko: {
    title: "팬 인증",
    help: "팬 활동을 인증하고 점수와 응모권을 모아보세요.",
    missions: "참여 가능한 인증",
    all: "전체",
    history: "내 인증 내역",
    loading: "인증을 불러오는 중이에요.",
    error: "인증을 불러오지 못했어요.",
    empty: "현재 참여할 수 있는 인증이 없어요.",
    historyEmpty: "아직 제출한 인증이 없어요.",
    login: "로그인하면 내 인증 내역을 확인할 수 있어요.",
    available: "참여 가능",
    preparing: "준비 중",
    closed: "종료",
    pending: "검토 중",
    approved: "승인",
    rejected: "반려",
    score: "점",
    ticket: "응모권",
    start: "인증하기",
    startQuiz: "퀴즈 풀기",
  },
  en: {
    title: "Fan verification",
    help: "Verify your fan activities to earn Fan Score and raffle tickets.",
    missions: "Available verification missions",
    all: "All",
    history: "My history",
    loading: "Loading verification missions.",
    error: "We couldn’t load verification missions.",
    empty: "No verification missions are available.",
    historyEmpty: "You have no submissions yet.",
    login: "Sign in to see your submission history.",
    available: "Available",
    preparing: "Preparing",
    closed: "Closed",
    pending: "Under review",
    approved: "Approved",
    rejected: "Rejected",
    score: "pts",
    ticket: "tickets",
    start: "Get verified",
    startQuiz: "Take quiz",
  },

  ...additionalLocales((translationLocale) => ({
    title: localizedMessages.m84776792a6a6[translationLocale],
    help: localizedMessages.m120b7dd6d7bc[translationLocale],
    missions: localizedMessages.m5acaed52a19a[translationLocale],
    all: localizedMessages.mfbe0f0d8b589[translationLocale],
    history: localizedMessages.m577093b578a3[translationLocale],
    loading: localizedMessages.m8c73c29c5ef0[translationLocale],
    error: localizedMessages.mc084de4feb8e[translationLocale],
    empty: localizedMessages.me8850e1b06b4[translationLocale],
    historyEmpty: localizedMessages.m08188f574c68[translationLocale],
    login: localizedMessages.m79fd84b32847[translationLocale],
    available: localizedMessages.m26877e0405a0[translationLocale],
    preparing: localizedMessages.me6800ee5bcd0[translationLocale],
    closed: localizedMessages.m6797acdc4160[translationLocale],
    pending: localizedMessages.mbaf38767e5fa[translationLocale],
    approved: localizedMessages.mc01385355806[translationLocale],
    rejected: localizedMessages.m0f0c1691895f[translationLocale],
    score: localizedMessages.m5224845219bc[translationLocale],
    ticket: localizedMessages.m1925bade61c2[translationLocale],
    start: localizedMessages.mfd7692d3f746[translationLocale],
    startQuiz: localizedMessages.m75cba4550bc8[translationLocale],
  }))
} as const;

export function CertificationPanel({
  slug,
  locale,
  initialTab = "missions",
}: {
  slug: string;
  locale: AppLocale;
  initialTab?: "missions" | "history";
}) {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const t = copy[locale];
  const panelId = useId();
  const [tab, setTab] = useState<"missions" | "history">(initialTab);
  const [items, setItems] = useState<CertificationListItem[]>([]);
  const [category, setCategory] = useState<string>("");
  const [historyItems, setHistory] = useState<CertificationHistoryItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const ownerKey = authenticated ? (user?.id ?? null) : null;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState("loading");
      try {
        if (tab === "missions") {
          const response = await fetch(
            `/api/celebrities/${encodeURIComponent(slug)}/certifications?locale=${toContentLocale(locale)}`,
            { signal },
          );
          if (!response.ok) throw new Error();
          const body = await response.json();
          setItems(
            z.array(certificationListItemSchema).parse(body.certifications),
          );
        } else if (ready && authenticated && ownerKey) {
          const token = await getAccessToken();
          const response = await fetch(
            `/api/me/celebrities/${encodeURIComponent(slug)}/certifications?locale=${toContentLocale(locale)}`,
            {
              headers: { authorization: `Bearer ${token}` },
              cache: "no-store",
              signal,
            },
          );
          if (!response.ok) throw new Error();
          const body = await response.json();
          if (!signal?.aborted)
            setHistory(z.array(historyItemSchema).parse(body.certifications));
        }
        if (!signal?.aborted) setState("ready");
      } catch {
        if (!signal?.aborted) setState("error");
      }
    },
    [authenticated, getAccessToken, locale, ownerKey, ready, slug, tab],
  );
  useEffect(() => {
    setHistory([]);
  }, [ownerKey]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "missions"
        : event.key === "End"
          ? "history"
          : tab === "missions"
            ? "history"
            : "missions";
    setTab(next);
    document.getElementById(`${panelId}-${next}`)?.focus();
  }
  const categories = [...new Set(items.map((item) => item.category))];
  const selectedCategory = categories.includes(category) ? category : "";
  const filteredItems = items.filter(
    (item) => !selectedCategory || item.category === selectedCategory,
  );
  return (
    <section className={styles.panel} aria-labelledby={`${panelId}-heading`}>
      <header className={styles.panelHeading}>
        <h2 id={`${panelId}-heading`}>
          <Sparkles aria-hidden="true" />
          {t.title}
        </h2>
        <p>{t.help}</p>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={t.title}>
        <button
          type="button"
          role="tab"
          id={`${panelId}-missions`}
          aria-controls={`${panelId}-content`}
          aria-selected={tab === "missions"}
          tabIndex={tab === "missions" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => setTab("missions")}
        >
          <Award aria-hidden="true" />
          {t.missions}
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-history`}
          aria-controls={`${panelId}-content`}
          aria-selected={tab === "history"}
          tabIndex={tab === "history" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => setTab("history")}
        >
          <History aria-hidden="true" />
          {t.history}
        </button>
      </div>
      <div
        id={`${panelId}-content`}
        role="tabpanel"
        aria-labelledby={`${panelId}-${tab}`}
      >
        {state === "loading" ? (
          <p className={styles.state} role="status">
            {t.loading}
          </p>
        ) : state === "error" ? (
          <div className={styles.state} role="alert">
            <p>{t.error}</p>
            <button type="button" onClick={() => void load()}>
              {locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m31610d1a288d, "Try again")}
            </button>
          </div>
        ) : tab === "missions" ? (
          <div className={styles.missions}>
            {items.length ? (
              <div
                className={styles.categories}
                aria-label={
                  locale === "ko" ? "인증 카테고리" : translate(locale, localizedMessages.m55f6d05a1ab8, "Certification categories")
                }
              >
                <button
                  type="button"
                  aria-pressed={!selectedCategory}
                  onClick={() => setCategory("")}
                >
                  {t.all}
                </button>
                {categories.map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={selectedCategory === value}
                    onClick={() => setCategory(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : null}
            {items.length ? (
              <ul className={styles.missionGrid}>
                {filteredItems.map((item) => {
                  const content = (
                    <>
                      <span className={styles.cardHeading}>
                        <span className={styles.kind} aria-hidden="true">
                          {item.membershipPlatform ? (
                            <Image
                              src={`/images/guest-home/${item.membershipPlatform}.svg`}
                              alt=""
                              width={24}
                              height={24}
                            />
                          ) : item.kind === "quiz" ? (
                            <BadgeCheck />
                          ) : item.kind === "live_mission" ? (
                            <Play />
                          ) : (
                            <Camera />
                          )}
                        </span>
                        <span className={styles.cardIdentity}>
                          <span className={styles.cardCategory}>
                            {item.category}
                          </span>
                          <strong>{item.title}</strong>
                        </span>
                      </span>
                      <span className={styles.cardDescription}>
                        {item.description}
                      </span>
                      <span className={styles.cardFooter}>
                        <span className={styles.reward}>
                          {item.reward?.scorePoints ? (
                            <span>
                              +{item.reward.scorePoints}
                              {locale === "en" ? " " : ""}
                              {t.score}
                            </span>
                          ) : null}
                          {item.reward?.stampCount ? (
                            <span>
                              <Crown aria-hidden="true" />
                              {locale === "ko" ? "멤버십 Stamp 1개" : translate(locale, localizedMessages.mdf1cff686174, "1 Membership Stamp")}
                            </span>
                          ) : null}
                          {item.reward?.ticketAmount ? (
                            <span>
                              <Ticket aria-hidden="true" />+
                              {item.reward.ticketAmount} {t.ticket}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={styles.cardAction}
                          data-status={item.status}
                        >
                          {item.status === "available" ? (
                            <>
                              <span className={styles.srOnly}>
                                {t.available} ·{" "}
                              </span>
                              {item.kind === "quiz" ? t.startQuiz : t.start}
                              <ChevronRight aria-hidden="true" />
                            </>
                          ) : (
                            t[item.status]
                          )}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.status === "available" ? (
                        <Link
                          href={item.actionHref as Route}
                          className={styles.card}
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className={styles.card} data-disabled="true">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.state}>{t.empty}</p>
            )}
          </div>
        ) : !ready ? (
          <p className={styles.state}>{t.loading}</p>
        ) : !authenticated ? (
          <p className={styles.state}>{t.login}</p>
        ) : (
          <div className={styles.list}>
            {historyItems.length ? (
              historyItems.map((item) => (
                <Link
                  key={item.id}
                  href={
                    `${item.actionHref}${item.actionHref.includes("?") ? "&" : "?"}submission=${encodeURIComponent(item.id)}` as Route
                  }
                  className={styles.row}
                >
                  <Clock3 aria-hidden="true" />
                  <span className={styles.rowCopy}>
                    <strong>{item.title}</strong>
                    {item.membershipPlatform ? (
                      <small>
                        {membershipPlatformLabel(item.membershipPlatform)}
                      </small>
                    ) : null}
                    <small>
                      {new Intl.DateTimeFormat(locale, { calendar: "gregory",
                        dateStyle: "medium",
                      }).format(new Date(item.submittedAt))}{" "}
                      · #{item.attemptNumber}
                    </small>
                    {item.rejectionReason ? (
                      <span className={styles.reason}>
                        {item.rejectionReason}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.status} data-status={item.status}>
                    {item.status === "rejected" && item.membershipPlatform
                      ? locale === "ko" ? "보완 필요" : translate(locale, localizedMessages.m3fe001e864cd, "More proof needed")
                      : t[item.status]}
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              ))
            ) : (
              <p className={styles.state}>{t.historyEmpty}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
