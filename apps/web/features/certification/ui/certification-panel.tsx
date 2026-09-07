"use client";
import { usePrivy } from "@privy-io/react-auth";
import { Award, ChevronRight, Clock3, History, Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  certificationListItemSchema,
  historyItemSchema,
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
  },
  en: {
    title: "Fan certifications",
    help: "Verify fan activities and earn score and raffle tickets.",
    missions: "Available certifications",
    all: "All",
    history: "My history",
    loading: "Loading certifications.",
    error: "We couldn’t load certifications.",
    empty: "No certifications are available.",
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
  },
} as const;

export function CertificationPanel({
  slug,
  locale,
  initialTab = "missions",
}: {
  slug: string;
  locale: CertificationLocale;
  initialTab?: "missions" | "history";
}) {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const t = copy[locale];
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
            `/api/celebrities/${encodeURIComponent(slug)}/certifications?locale=${locale}`,
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
            `/api/me/celebrities/${encodeURIComponent(slug)}/certifications?locale=${locale}`,
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
  return (
    <section className={styles.panel} aria-labelledby="certification-heading">
      <header className={styles.panelHeading}>
        <div>
          <p>
            <Sparkles aria-hidden="true" />
            {t.title}
          </p>
          <h2 id="certification-heading">{t.help}</h2>
        </div>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={t.title}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "missions"}
          onClick={() => setTab("missions")}
        >
          <Award aria-hidden="true" />
          {t.missions}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          <History aria-hidden="true" />
          {t.history}
        </button>
      </div>
      {state === "loading" ? (
        <p className={styles.state} role="status">
          {t.loading}
        </p>
      ) : state === "error" ? (
        <div className={styles.state} role="alert">
          <p>{t.error}</p>
          <button type="button" onClick={() => void load()}>
            {locale === "ko" ? "다시 시도" : "Try again"}
          </button>
        </div>
      ) : tab === "missions" ? (
        <div className={styles.list}>
          {items.length ? (
            <div
              className={styles.categories}
              aria-label={
                locale === "ko" ? "인증 카테고리" : "Certification categories"
              }
            >
              <button
                type="button"
                aria-pressed={!category}
                onClick={() => setCategory("")}
              >
                {t.all}
              </button>
              {[...new Set(items.map((item) => item.category))].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          ) : null}
          {items.length ? (
            items
              .filter((item) => !category || item.category === category)
              .map((item) => {
                const content = (
                  <>
                    <span className={styles.kind}>
                      {item.kind === "quiz"
                        ? "QUIZ"
                        : item.kind === "live_mission"
                          ? "LIVE"
                          : "PROOF"}
                    </span>
                    <span className={styles.rowCopy}>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                      <span className={styles.reward}>
                        {item.reward
                          ? `+${item.reward.scorePoints}${t.score} · +${item.reward.ticketAmount} ${t.ticket}`
                          : ""}
                      </span>
                    </span>
                    <span className={styles.status} data-status={item.status}>
                      {t[item.status]}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </>
                );
                return item.status === "available" ? (
                  <Link
                    key={item.id}
                    href={item.actionHref as Route}
                    className={styles.row}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={item.id}
                    className={styles.row}
                    data-disabled="true"
                  >
                    {content}
                  </div>
                );
              })
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
                href={`${item.actionHref}${item.actionHref.includes("?") ? "&" : "?"}submission=${encodeURIComponent(item.id)}` as Route}
                className={styles.row}
              >
                <Clock3 aria-hidden="true" />
                <span className={styles.rowCopy}>
                  <strong>{item.title}</strong>
                  <small>
                    {new Intl.DateTimeFormat(locale, {
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
                  {t[item.status]}
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))
          ) : (
            <p className={styles.state}>{t.historyEmpty}</p>
          )}
        </div>
      )}
    </section>
  );
}
