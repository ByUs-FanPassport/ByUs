"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Link from "next/link";
import {
  FanAppFrame,
  FanContentContainer,
} from "@/components/fan-shell/fan-app-shell";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  LockKeyhole,
  TicketCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { consumeAuthIntent, readAuthIntent } from "@/components/auth-intent";
import { AuthIntentLink } from "@/components/auth-intent-link";
import {
  BottomSheet,
  Dialog,
  Drawer,
} from "@/components/ui/overlay/accessible-overlay";
import { FanAction, fanActionClassName } from "@/components/fan-ui/fan-action";
import { FanMotionIcon } from "@/components/fan-ui/fan-motion-icon";

import {
  benefitCatalogItemSchema,
  benefitClaimResponseSchema,
  benefitApplicationResponseSchema,
  benefitOwnedApplicationResponseSchema,
  benefitListResponseSchema,
  type BenefitCatalogItem,
  type BenefitClaimResponse,
  type BenefitApplicationResponse,
  type BenefitOwnedApplicationResponse,
} from "../domain/benefit";
import { benefitEligibilityLabel, formatBenefitDateTime } from "./benefit-presentation";
import styles from "./benefit-screen.module.css";
import {
  benefitEntryResultSchema,
  type BenefitEntryResult,
} from "../domain/benefit-entry";
import {
  pageViewIdempotencyKey,
  recordProductEventV1,
} from "@/features/analytics/client/product-event-client";
import {
  ifewBenefitId,
  ifewLiveHref,
  ifewPrizeName,
  ifewVerificationHref,
} from "@/features/live/domain/ifew-event";

export type BenefitLocale = "ko" | "en";

const benefitUpdatedEvent = "byus:benefit-updated";

type BenefitUpdatedDetail = Pick<
  BenefitCatalogItem,
  "id" | "state" | "applicationStatus"
>;

const celebritiesResponseSchema = z.object({
  celebrities: z.array(z.object({ slug: z.string(), name: z.string() })),
});

const copy = {
  ko: {
    nav: ["홈", "셀럽", "라이브", "패스포트", "혜택"],
    title: "팬 혜택",
    subtitle: "함께한 기록으로 열리는 특별한 혜택을 확인하세요.",
    filter: "셀럽 선택",
    allEmpty: "공개된 혜택이 아직 없어요.",
    filterEmpty: "이 셀럽의 공개된 혜택이 아직 없어요.",
    emptyHelp: "새 혜택이 열리면 이곳에서 바로 확인할 수 있어요.",
    loadError: "혜택을 불러오지 못했어요.",
    loadHelp: "잠시 후 다시 시도해 주세요.",
    retry: "다시 불러오기",
    back: "혜택 목록",
    details: "혜택 자세히 보기",
    states: {
      locked: "잠김",
      eligible: "수령 가능",
      claimed: "수령 완료",
      sold_out: "소진",
      expired: "종료",
    },
    period: "수령 기간",
    periodStart: "시작",
    periodEnd: "마감",
    requirement: "받으려면",
    delivery: "받는 방법",
    score: "필요 팬 점수",
    level: "필요 등급",
    stamp: "필요 도장",
    activity: "필요 활동",
    claim: "혜택 수령하기",
    signIn: "로그인하고 혜택 이어받기",
    signInToEnter: "로그인하고 응모하기",
    claiming: "수령 처리 중",
    locked: "조건을 달성하면 수령할 수 있어요",
    claimed: "이미 수령한 혜택이에요",
    sold_out: "준비된 혜택이 모두 소진되었어요",
    expired: "이 혜택은 수령 기간이 끝났어요.",
    claimError:
      "혜택을 수령하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.",
    apply: "혜택 신청하기",
    applying: "신청 처리 중",
    applyError:
      "혜택을 신청하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.",
    applicationStates: {
      submitted: "신청이 접수되었어요",
      selected: "혜택 대상자로 선정되었어요",
      not_selected: "이번 혜택의 선정이 완료되었어요",
    },
    enter: "응모권으로 응모하기",
    entering: "응모 처리 중",
    tickets: "보유 응모권",
    enteredTickets: "이 혜택의 응모 수",
    entryLimit: "혜택별 응모 한도",
    noEntryLimit: "제한 없음",
    entryAmount: "사용할 응모권 수",
    entryHistory: "응모 이력",
    entryConfirmTitle: "응모권 사용 확인",
    entryConfirmHelp: "확정하면 응모권이 즉시 차감돼요.",
    entryCurrentBalance: "현재 보유",
    entryDebit: "이번 차감",
    entryRemainingBalance: "응모 후 잔액",
    entryConfirm: "이 수량으로 응모 확정",
    entryCancel: "수량 다시 선택",
    entrySuccess: "응모가 완료됐어요",
    entryAgain: "응모권 추가 사용",
    entryZero: "현재 보유한 응모권이 없어요.",
    entrySpent: "보유 응모권을 모두 사용했어요.",
    entryLimitReached: "이 혜택의 응모 한도에 도달했어요.",
    entryClosed: "응모가 종료됐어요.",
    entryError: "응모하지 못했어요. 응모권 잔액과 응모 기간을 확인해 주세요.",
    delivered: "혜택이 안전하게 전달되었어요",
    text: "혜택 내용",
    code: "혜택 코드",
    open: "혜택 열기",
    copy: "코드 복사",
    copied: "복사됨",
    notFound: "공개된 혜택을 찾을 수 없어요.",
    locale: "KO / EN",
  },
  en: {
    nav: ["Home", "Celebrities", "Live", "Passports", "Benefits"],
    title: "Fan benefits",
    subtitle: "Discover benefits unlocked by the moments you have shared.",
    filter: "Choose a celebrity",
    allEmpty: "There are no published benefits yet.",
    filterEmpty: "This celebrity has no published benefits yet.",
    emptyHelp: "New benefits will appear here as soon as they open.",
    loadError: "We couldn’t load benefits.",
    loadHelp: "Please try again shortly.",
    retry: "Try again",
    back: "Benefits",
    details: "View benefit details",
    states: {
      locked: "Locked",
      eligible: "Eligible",
      claimed: "Claimed",
      sold_out: "Sold out",
      expired: "Ended",
    },
    period: "Claim period",
    periodStart: "Opens",
    periodEnd: "Closes",
    requirement: "Eligibility",
    delivery: "Delivery",
    score: "Fan score",
    level: "Level",
    stamp: "Stamp",
    activity: "Activity",
    claim: "Claim benefit",
    signIn: "Sign in to continue",
    signInToEnter: "Sign in to enter",
    claiming: "Claiming",
    locked: "Complete the requirements to claim",
    claimed: "You already claimed this benefit",
    sold_out: "All available benefits have been claimed",
    expired: "The claim period has ended",
    claimError:
      "We couldn’t claim this benefit. Check its status and try again.",
    apply: "Apply for benefit",
    applying: "Submitting",
    applyError:
      "We couldn’t submit your application. Check its status and try again.",
    applicationStates: {
      submitted: "Your application has been submitted",
      selected: "You were selected for this benefit",
      not_selected: "Selection for this benefit is complete",
    },
    enter: "Enter with raffle tickets",
    entering: "Entering",
    tickets: "Available raffle tickets",
    enteredTickets: "Your entries for this benefit",
    entryLimit: "Per-Benefit entry limit",
    noEntryLimit: "No limit",
    entryAmount: "Raffle tickets to use",
    entryHistory: "Entry history",
    entryConfirmTitle: "Confirm raffle ticket use",
    entryConfirmHelp:
      "Your raffle tickets are deducted immediately after confirmation.",
    entryCurrentBalance: "Current balance",
    entryDebit: "This entry",
    entryRemainingBalance: "Balance after entry",
    entryConfirm: "Confirm this entry",
    entryCancel: "Change quantity",
    entrySuccess: "Your entry is complete",
    entryAgain: "Use more raffle tickets",
    entryZero: "You don’t currently have any raffle tickets.",
    entrySpent: "You have used all available raffle tickets.",
    entryLimitReached: "You reached this benefit’s entry limit.",
    entryClosed: "This raffle has ended.",
    entryError:
      "Entry failed. Check your raffle ticket balance and entry window.",
    delivered: "Your benefit was delivered securely",
    text: "Benefit details",
    code: "Benefit code",
    open: "Open benefit",
    copy: "Copy code",
    copied: "Copied",
    notFound: "This published benefit could not be found.",
    locale: "EN / KO",
  },
} as const;

function query(locale: BenefitLocale, celebrity?: string) {
  const params = new URLSearchParams({ locale });
  if (celebrity) params.set("celebrity", celebrity);
  return params.toString();
}

function formatDate(value: string, locale: BenefitLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function localizeBenefitValue(value: string, locale: BenefitLocale) {
  if (locale !== "ko") return value;
  const normalized = value.trim().toLowerCase();
  const knownValues: Record<string, string> = {
    bronze: "브론즈",
    silver: "실버",
    gold: "골드",
    survey: "설문",
    "survey stamp 보유": "설문 도장 보유",
    "공식 youtube url": "공식 YouTube 링크",
  };
  return knownValues[normalized] ?? value;
}

function benefitStateLabel(benefit: BenefitCatalogItem, locale: BenefitLocale): string {
  const { state, applicationStatus, entry, allocationMode } = benefit;
  if (state === "claimed") return copy[locale].states.claimed;
  if (applicationStatus === "selected") return locale === "ko" ? "선정 완료" : "Selected";
  if (applicationStatus === "submitted") return locale === "ko" ? "신청 완료" : "Application submitted";
  if (applicationStatus === "not_selected") return locale === "ko" ? "선정 종료" : "Selection complete";
  if (entry) {
    if (entry.canEnter) return locale === "ko" ? "응모 가능" : "Open for entries";
    if (Date.now() < Date.parse(entry.entryOpensAt)) return locale === "ko" ? "응모 예정" : "Entries open soon";
    return locale === "ko" ? "응모 종료" : "Entries closed";
  }
  if (state === "eligible" && allocationMode === "application_selection") {
    return locale === "ko" ? "신청 가능" : "Open for applications";
  }
  return copy[locale].states[state];
}

function StateBadge({
  benefit,
  locale,
}: {
  benefit: BenefitCatalogItem;
  locale: BenefitLocale;
}) {
  const { state } = benefit;
  return (
    <span className={styles.stateBadge} data-state={state}>
      {state === "claimed" && <Check aria-hidden="true" />}
      {state === "locked" && !benefit.entry && <LockKeyhole aria-hidden="true" />}
      {benefitStateLabel(benefit, locale)}
    </span>
  );
}

function RequirementList({
  benefit,
  locale,
}: {
  benefit: BenefitCatalogItem;
  locale: BenefitLocale;
}) {
  const c = copy[locale];
  const showScore = !benefit.entry || benefit.minimumScore > 0;
  const showLevel = !benefit.entry || benefit.minimumLevel !== "Bronze";
  if (
    !showScore &&
    !showLevel &&
    !benefit.requiredStampType &&
    !benefit.requiredActivityType
  )
    return null;
  return (
    <dl className={styles.requirements}>
      {showScore && (
        <div>
          <dt>{c.score}</dt>
          <dd>
            {new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US").format(
              benefit.minimumScore,
            )}
          </dd>
        </div>
      )}
      {showLevel && (
        <div>
          <dt>{c.level}</dt>
          <dd>{localizeBenefitValue(benefit.minimumLevel, locale)}</dd>
        </div>
      )}
      {benefit.requiredStampType && (
        <div>
          <dt>{c.stamp}</dt>
          <dd>{localizeBenefitValue(benefit.requiredStampType, locale)}</dd>
        </div>
      )}
      {benefit.requiredActivityType && (
        <div>
          <dt>{c.activity}</dt>
          <dd>{localizeBenefitValue(benefit.requiredActivityType, locale)}</dd>
        </div>
      )}
    </dl>
  );
}

type ListView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; benefits: BenefitCatalogItem[] };

export function BenefitsScreen({
  locale,
  initialCelebrity,
}: {
  locale: BenefitLocale;
  initialCelebrity?: string;
}) {
  const c = copy[locale];
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [celebrities, setCelebrities] = useState<
    Array<{ slug: string; name: string }>
  >([]);
  const [selected, setSelected] = useState(initialCelebrity ?? "");
  const [view, setView] = useState<ListView>({ kind: "loading" });

  const loadCelebrities = useCallback(async () => {
    try {
      const response = await fetch(`/api/public/celebrities?locale=${locale}`);
      if (!response.ok) throw new Error();
      const data = celebritiesResponseSchema.parse(await response.json());
      setCelebrities(data.celebrities);
      setSelected((value) => value || data.celebrities[0]?.slug || "");
    } catch {
      setCelebrities([]);
      setView({ kind: "error" });
    }
  }, [locale]);
  useEffect(() => {
    void loadCelebrities();
  }, [loadCelebrities]);
  useEffect(() => {
    function updateBenefit(event: Event) {
      const detail = (event as CustomEvent<BenefitUpdatedDetail>).detail;
      if (!detail?.id) return;
      setView((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              benefits: current.benefits.map((benefit) =>
                benefit.id === detail.id
                  ? {
                      ...benefit,
                      state: detail.state,
                      applicationStatus: detail.applicationStatus,
                    }
                  : benefit,
              ),
            }
          : current,
      );
    }
    window.addEventListener(benefitUpdatedEvent, updateBenefit);
    return () => window.removeEventListener(benefitUpdatedEvent, updateBenefit);
  }, []);

  const load = useCallback(async () => {
    if (!ready || !selected) return;
    setView({ kind: "loading" });
    try {
      const token = authenticated ? await getAccessToken() : null;
      const response = await fetch(`/api/benefits?${query(locale, selected)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      setView({
        kind: "ready",
        benefits: benefitListResponseSchema.parse(await response.json())
          .benefits,
      });
    } catch {
      setView({ kind: "error" });
    }
  }, [authenticated, getAccessToken, locale, ready, selected]);
  useEffect(() => {
    void load();
  }, [load]);

  function choose(value: string) {
    setSelected(value);
    router.replace(`/benefits?${query(locale, value)}` as Route, {
      scroll: false,
    });
  }

  return (
    <FanAppFrame locale={locale} mainId="benefit-content">
      <div className={styles.page}>
        <FanContentContainer
          as="main"
          className={styles.main}
          id="benefit-content"
          tabIndex={-1}
        >
        <div className={styles.listHeading}>
          <div>
            <h1>{c.title}</h1>
            <p>{c.subtitle}</p>
          </div>
          <label>
            {c.filter}
            <select
              value={selected}
              onChange={(event) => choose(event.target.value)}
              disabled={!celebrities.length}
            >
              {celebrities.map((celebrity) => (
                <option key={celebrity.slug} value={celebrity.slug}>
                  {celebrity.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {view.kind === "loading" && (
          <div
            className={styles.skeletonGrid}
            role="status"
            aria-busy="true"
            aria-label={
              locale === "ko" ? "혜택 불러오는 중" : "Loading benefits"
            }
          >
            {[0, 1, 2].map((item) => (
              <div key={item}>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        )}
        {view.kind === "error" && (
          <section className={styles.message} role="alert">
            <TicketCheck aria-hidden="true" />
            <h2>{c.loadError}</h2>
            <p>{c.loadHelp}</p>
            <button
              type="button"
              onClick={() => void (selected ? load() : loadCelebrities())}
            >
              {c.retry}
            </button>
          </section>
        )}
        {view.kind === "ready" && view.benefits.length === 0 && (
          <section className={styles.message} role="status">
            <TicketCheck aria-hidden="true" />
            <h2>{selected ? c.filterEmpty : c.allEmpty}</h2>
            <p>{c.emptyHelp}</p>
          </section>
        )}
        {view.kind === "ready" && view.benefits.length > 0 && (
          <div className={styles.benefitList}>
            {view.benefits.map((benefit) => (
              <article className={styles.benefitRow} key={benefit.id}>
                <div className={styles.rowContent}>
                  <StateBadge benefit={benefit} locale={locale} />
                  <h2>{benefit.title}</h2>
                  <p>{benefit.summary}</p>
                  <span>{benefitEligibilityLabel(benefit, locale)}</span>
                </div>
                <Link
                  className={styles.rowLink}
                  href={
                    `/benefits/${benefit.id}?${query(locale, selected)}` as Route
                  }
                  scroll={false}
                  aria-label={`${benefit.title}: ${c.details}`}
                >
                  <ArrowRight aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        )}
      </FanContentContainer>
      </div>
    </FanAppFrame>
  );
}

type DetailView =
  | { kind: "loading" }
  | { kind: "error"; notFound: boolean }
  | { kind: "ready"; benefit: BenefitCatalogItem };

export function BenefitDetailScreen({
  benefitId,
  locale,
  celebrity,
  presentation = "page",
  onBusyChange,
}: {
  benefitId: string;
  locale: BenefitLocale;
  celebrity?: string;
  presentation?: "page" | "overlay";
  onBusyChange?: (busy: boolean) => void;
}) {
  const c = copy[locale];
  const { ready, authenticated, getAccessToken } = usePrivy();
  const mobileEntryConfirmation = useMobileBenefitOverlay();
  const EntryConfirmationOverlay = mobileEntryConfirmation ? BottomSheet : Dialog;
  const [view, setView] = useState<DetailView>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  useEffect(() => {
    onBusyChange?.(pending);
    return () => onBusyChange?.(false);
  }, [onBusyChange, pending]);
  const [claim, setClaim] = useState<BenefitClaimResponse | null>(null);
  const [application, setApplication] =
    useState<BenefitApplicationResponse | null>(null);
  const [ownedApplication, setOwnedApplication] =
    useState<BenefitOwnedApplicationResponse | null>(null);
  const [actionError, setActionError] = useState(false);
  const [entryAmount, setEntryAmount] = useState("1");
  const [entryResult, setEntryResult] = useState<BenefitEntryResult | null>(
    null,
  );
  const [entryConfirmation, setEntryConfirmation] = useState<number | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const claimRef = useRef<Promise<void> | null>(null);
  const resumedIntentRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!ready) return;
    setView({ kind: "loading" });
    try {
      const token = authenticated ? await getAccessToken() : null;
      const response = await fetch(
        `/api/benefits/${encodeURIComponent(benefitId)}?locale=${locale}`,
        {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        },
      );
      if (!response.ok) {
        setView({ kind: "error", notFound: response.status === 404 });
        return;
      }
      const body = z
        .object({ benefit: benefitCatalogItemSchema })
        .parse(await response.json());
      if (token && body.benefit.applicationStatus) {
        const ownedResponse = await fetch(
          `/api/benefits/${encodeURIComponent(benefitId)}/applications`,
          { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        if (!ownedResponse.ok) throw new Error();
        const owned = z
          .object({ application: benefitOwnedApplicationResponseSchema })
          .parse(await ownedResponse.json()).application;
        setOwnedApplication(owned);
      } else setOwnedApplication(null);
      setView({ kind: "ready", benefit: body.benefit });
      void recordProductEventV1(
        {
          eventName: "benefit_page_view",
          celebrityId: null,
          liveEventId: null,
          missionId: null,
          benefitId: body.benefit.id,
          source: "fan.benefit.detail",
          idempotencyKey: pageViewIdempotencyKey(
            "benefit_page_view",
            `/benefits/${body.benefit.id}`,
          ),
          properties: { presentation: presentation ?? "page" },
        },
        token,
      );
    } catch {
      setView({ kind: "error", notFound: false });
    }
  }, [authenticated, benefitId, getAccessToken, locale, presentation, ready]);
  useEffect(() => {
    void load();
  }, [load]);

  const claimBenefit = useCallback(async () => {
    if (view.kind !== "ready" || pending || claimRef.current) return;
    const operation = (async () => {
      setPending(true);
      setActionError(false);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error();
        const keyName = `byus:benefit-claim:${benefitId}`;
        let idempotencyKey = sessionStorage.getItem(keyName);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          sessionStorage.setItem(keyName, idempotencyKey);
        }
        const response = await fetch(
          `/api/benefits/${encodeURIComponent(benefitId)}/claim`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ idempotencyKey }),
          },
        );
        if (!response.ok) throw new Error();
        const result = benefitClaimResponseSchema.parse(await response.json());
        setClaim(result);
        sessionStorage.removeItem(keyName);
        setView({
          kind: "ready",
          benefit: { ...view.benefit, state: "claimed" },
        });
        window.dispatchEvent(
          new CustomEvent<BenefitUpdatedDetail>(benefitUpdatedEvent, {
            detail: {
              id: benefitId,
              state: "claimed",
              applicationStatus: view.benefit.applicationStatus,
            },
          }),
        );
        const intentId = new URLSearchParams(window.location.search).get(
          "authIntent",
        );
        if (intentId) consumeAuthIntent(window.sessionStorage, intentId);
      } catch {
        setActionError(true);
      } finally {
        setPending(false);
        claimRef.current = null;
      }
    })();
    claimRef.current = operation;
    await operation;
  }, [benefitId, getAccessToken, pending, view]);
  const applyForBenefit = useCallback(async () => {
    if (
      view.kind !== "ready" ||
      pending ||
      claimRef.current ||
      view.benefit.allocationMode !== "application_selection"
    )
      return;
    const operation = (async () => {
      setPending(true);
      setActionError(false);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error();
        const keyName = `byus:benefit-application:${benefitId}`;
        let idempotencyKey = sessionStorage.getItem(keyName);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          sessionStorage.setItem(keyName, idempotencyKey);
        }
        const response = await fetch(
          `/api/benefits/${encodeURIComponent(benefitId)}/applications`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "idempotency-key": idempotencyKey,
            },
          },
        );
        if (!response.ok) throw new Error();
        const result = benefitApplicationResponseSchema.parse(
          await response.json(),
        );
        setApplication(result);
        sessionStorage.removeItem(keyName);
        setView({
          kind: "ready",
          benefit: { ...view.benefit, applicationStatus: result.status },
        });
        window.dispatchEvent(
          new CustomEvent<BenefitUpdatedDetail>(benefitUpdatedEvent, {
            detail: {
              id: benefitId,
              state: view.benefit.state,
              applicationStatus: result.status,
            },
          }),
        );
        const intentId = new URLSearchParams(window.location.search).get(
          "authIntent",
        );
        if (intentId) consumeAuthIntent(window.sessionStorage, intentId);
      } catch {
        setActionError(true);
      } finally {
        setPending(false);
        claimRef.current = null;
      }
    })();
    claimRef.current = operation;
    await operation;
  }, [benefitId, getAccessToken, pending, view]);
  const enterBenefit = useCallback(
    async (ticketAmount: number) => {
      if (
        view.kind !== "ready" ||
        !view.benefit.entry ||
        pending ||
        claimRef.current
      )
        return;
    const currentEntry = view.benefit.entry;
    if (!Number.isInteger(ticketAmount) || ticketAmount <= 0) return;
    const operation = (async () => {
      setPending(true);
      setActionError(false);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error();
          const keyName = `byus:benefit-entry:${benefitId}:${ticketAmount}`;
        let idempotencyKey = sessionStorage.getItem(keyName);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          sessionStorage.setItem(keyName, idempotencyKey);
        }
          const response = await fetch(
            `/api/benefits/${encodeURIComponent(benefitId)}/entries`,
            {
          method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
          body: JSON.stringify({ idempotencyKey, ticketAmount }),
            },
          );
        if (!response.ok) throw new Error();
        const result = benefitEntryResultSchema.parse(await response.json());
        setEntryResult(result);
          setEntryConfirmation(null);
        sessionStorage.removeItem(keyName);
        setView({
          kind: "ready",
          benefit: {
            ...view.benefit,
            entry: {
              ...currentEntry,
              creatorTicketBalance: result.resultingBalance,
              enteredTickets: result.benefitTicketTotal,
              remainingBenefitTickets: result.remainingBenefitTickets,
                entries: [
                  {
                entryId: result.entryId,
                ticketAmount: result.ticketAmount,
                enteredAt: new Date().toISOString(),
                  },
                  ...currentEntry.entries,
                ],
            },
          },
        });
      } catch {
        setActionError(true);
      } finally {
        setPending(false);
        claimRef.current = null;
      }
    })();
    claimRef.current = operation;
    await operation;
    },
    [benefitId, getAccessToken, pending, view],
  );

  useEffect(() => {
    if (
      !authenticated ||
      view.kind !== "ready" ||
      view.benefit.state !== "eligible"
    )
      return;
    const intentId = new URLSearchParams(window.location.search).get(
      "authIntent",
    );
    if (!intentId || resumedIntentRef.current === intentId) return;
    const intent = readAuthIntent(window.sessionStorage, intentId);
    if (
      !intent ||
      intent.targetType !== "benefit" ||
      intent.targetId !== benefitId
    )
      return;
    resumedIntentRef.current = intentId;
    if (intent.actionType === "CLAIM_BENEFIT" && view.benefit.entry)
      consumeAuthIntent(window.sessionStorage, intentId);
    else if (
      intent.actionType === "CLAIM_BENEFIT" &&
      view.benefit.allocationMode === "direct_claim"
    )
      void claimBenefit();
    if (
      intent.actionType === "APPLY_BENEFIT" &&
      view.benefit.allocationMode === "application_selection"
    )
      void applyForBenefit();
  }, [applyForBenefit, authenticated, benefitId, claimBenefit, view]);
  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (view.kind === "loading")
    return presentation === "overlay" ? (
      <FanContentContainer
        as="main"
        className={`${styles.detailMain} ${styles.overlayMain}`}
        data-fan-surface
        lang={locale}
        aria-busy="true"
      >
        <div className={styles.detailSkeleton}>
          <i />
          <i />
          <i />
          <i />
        </div>
      </FanContentContainer>
    ) : (
      <FanAppFrame locale={locale} mainId="benefit-content">
        <div className={styles.page}>
          <FanContentContainer
            as="main"
            className={styles.detailMain}
            id="benefit-content"
            tabIndex={-1}
            aria-busy="true"
          >
          <div className={styles.detailSkeleton}>
            <i />
            <i />
            <i />
            <i />
          </div>
        </FanContentContainer>
        </div>
      </FanAppFrame>
    );
  if (view.kind === "error")
    return presentation === "overlay" ? (
      <FanContentContainer
        as="main"
        className={`${styles.detailMain} ${styles.overlayMain}`}
        data-fan-surface
        lang={locale}
      >
        <section
          className={styles.message}
          role={view.notFound ? "status" : "alert"}
        >
          <TicketCheck aria-hidden="true" />
          <h1>{view.notFound ? c.notFound : c.loadError}</h1>
          <p>{view.notFound ? c.emptyHelp : c.loadHelp}</p>
          {!view.notFound && (
            <button type="button" onClick={() => void load()}>
              {c.retry}
            </button>
          )}
        </section>
      </FanContentContainer>
    ) : (
      <FanAppFrame locale={locale} mainId="benefit-content">
        <div className={styles.page}>
          <FanContentContainer
            as="main"
            className={styles.detailMain}
            id="benefit-content"
            tabIndex={-1}
          >
          <section
            className={styles.message}
            role={view.notFound ? "status" : "alert"}
          >
            <TicketCheck aria-hidden="true" />
            <h1>{view.notFound ? c.notFound : c.loadError}</h1>
            <p>{view.notFound ? c.emptyHelp : c.loadHelp}</p>
            {!view.notFound && (
              <button type="button" onClick={() => void load()}>
                {c.retry}
              </button>
            )}
            <Link href={`/benefits?${query(locale, celebrity)}` as Route}>
              {c.back}
            </Link>
          </section>
        </FanContentContainer>
        </div>
      </FanAppFrame>
    );
  const benefit = view.benefit;
  const isIfewRaffle = benefit.id === ifewBenefitId && benefit.entry !== null;
  const detailTitle = isIfewRaffle ? ifewPrizeName[locale] : benefit.title;
  const detailSummary = isIfewRaffle
    ? locale === "ko"
      ? "10명을 추첨해 관람권을 1장씩 드려요. 이퓨 응모권은 추첨에 참여할 때 사용합니다."
      : "Ten winners receive one admission ticket each. Ifew raffle tickets are used to enter the draw."
    : benefit.summary;
  const deliveredClaim = claim ?? ownedApplication?.claim ?? null;
  const unavailableCopy =
    benefit.state === "locked"
      ? c.locked
      : benefit.state === "claimed"
        ? c.claimed
        : benefit.state === "sold_out"
          ? c.sold_out
          : c.expired;
  const detailContent = (
    <FanContentContainer
      as="main"
      className={`${styles.detailMain} ${presentation === "overlay" ? styles.overlayMain : ""}`}
      data-fan-surface
      lang={locale}
      id={presentation === "page" ? "benefit-content" : undefined}
    >
      {presentation === "page" && (
        <Link
          className={styles.back}
          href={`/benefits?${query(locale, celebrity)}` as Route}
        >
          <ArrowLeft aria-hidden="true" />
          {c.back}
        </Link>
      )}
      <article className={styles.detail}>
        <div className={styles.detailIntro}>
          <StateBadge benefit={benefit} locale={locale} />
          <h1>{detailTitle}</h1>
          <p>{detailSummary}</p>
        </div>
        <div className={styles.detailColumns}>
          <section>
            <h2>{benefit.entry ? locale === "ko" ? "응모하려면" : "How to enter" : c.requirement}</h2>
            <p>{localizeBenefitValue(benefitEligibilityLabel(benefit, locale), locale)}</p>
            <RequirementList benefit={benefit} locale={locale} />
          </section>
          <section>
            <h2>{c.delivery}</h2>
            <p>{localizeBenefitValue(benefit.deliveryLabel, locale)}</p>
            <dl className={styles.period}>
              <div>
                <dt>{benefit.entry ? locale === "ko" ? "응모 시작" : "Entries open" : c.periodStart}</dt>
                <dd>
                  <time dateTime={benefit.entry?.entryOpensAt ?? benefit.claimOpensAt}>
                    {formatBenefitDateTime(benefit.entry?.entryOpensAt ?? benefit.claimOpensAt, locale)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>{benefit.entry ? locale === "ko" ? "응모 마감" : "Entries close" : c.periodEnd}</dt>
                <dd>
                  <time dateTime={benefit.entry?.entryClosesAt ?? benefit.claimClosesAt}>
                    {formatBenefitDateTime(benefit.entry?.entryClosesAt ?? benefit.claimClosesAt, locale)}
                  </time>
                </dd>
              </div>
            </dl>
          </section>
        </div>
        {!authenticated && benefit.entry ? (
          <AuthIntentLink
            className={fanActionClassName("primary")}
            emphasis="primary"
            locale={locale}
            input={{
              sourcePath: `/benefits/${benefitId}`,
              sourceQuery: `?locale=${locale}${celebrity ? `&celebrity=${encodeURIComponent(celebrity)}` : ""}`,
              actionType: "CLAIM_BENEFIT",
              targetType: "benefit",
              targetId: benefitId,
            }}
          >
            {c.signInToEnter}
          </AuthIntentLink>
        ) : benefit.entry ? (
          <section className={styles.delivery} aria-live="polite">
            <FanMotionIcon name="ticket" size={24} />
            <div>
              <h2>{c.enter}</h2>
              <p>
                {isIfewRaffle
                  ? locale === "ko"
                    ? "사용할 이퓨 응모권 수량을 선택하고 직접 응모해 주세요. 팬 인증이나 LIVE 참여만으로 자동 응모되지는 않아요."
                    : "Choose how many ifew raffle tickets to use and submit your entry. Fan verification or LIVE participation does not enter you automatically."
                  : locale === "ko"
                    ? "이 크리에이터의 응모권을 사용해 혜택에 응모할 수 있어요."
                    : "Use this creator’s raffle tickets to enter for this benefit."}
              </p>
              <dl className={styles.period}>
                <div>
                  <dt>{c.tickets}</dt>
                  <dd>{benefit.entry.creatorTicketBalance}</dd>
                </div>
                <div>
                  <dt>{c.enteredTickets}</dt>
                  <dd>{benefit.entry.enteredTickets}</dd>
                </div>
                <div>
                  <dt>{c.entryLimit}</dt>
                  <dd>{benefit.entry.perFanTicketLimit ?? c.noEntryLimit}</dd>
                </div>
              </dl>
              {entryResult ? (
                <div className={styles.entrySuccess} role="status">
                  <Check aria-hidden="true" />
                  <div>
                    <strong>{c.entrySuccess}</strong>
                    <span>
                      {entryResult.ticketAmount}{" "}
                      {locale === "ko" ? "응모" : "entries"} ·{" "}
                      {c.entryRemainingBalance} {entryResult.resultingBalance}
                    </span>
                  </div>
                  {benefit.entry.canEnter &&
                  benefit.entry.creatorTicketBalance > 0 &&
                  benefit.entry.remainingBenefitTickets !== 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEntryResult(null);
                        setEntryAmount("1");
                      }}
                    >
                      {c.entryAgain}
                    </button>
                  ) : (
                    <p>
                      {!benefit.entry.canEnter
                        ? c.entryClosed
                        : benefit.entry.remainingBenefitTickets === 0
                          ? c.entryLimitReached
                          : c.entrySpent}
                    </p>
                  )}
                </div>
              ) : !benefit.entry.canEnter ||
                benefit.entry.remainingBenefitTickets === 0 ||
                benefit.entry.creatorTicketBalance === 0 ? (
                <div className={styles.entryEmpty} role="status">
                  <strong>
                    {!benefit.entry.canEnter
                      ? c.entryClosed
                      : benefit.entry.remainingBenefitTickets === 0
                        ? c.entryLimitReached
                        : c.entryZero}
                  </strong>
                  {isIfewRaffle &&
                    benefit.entry.canEnter &&
                    benefit.entry.remainingBenefitTickets !== 0 &&
                    benefit.entry.creatorTicketBalance === 0 && (
                      <>
                        {benefit.entry.enteredTickets === 0 ? (
                          <>
                            <p>
                              {locale === "ko"
                                ? "팬 인증이나 LIVE 출석 등 팬 활동에서 이퓨 응모권을 받을 수 있어요. 받은 응모권은 수량을 선택해 직접 응모해야 해요."
                                : "You can get ifew raffle tickets through fan verification or LIVE attendance. Choose how many to use and submit your entry yourself."}
                            </p>
                            <FanAction
                              variant="primary"
                              href={ifewVerificationHref(locale)}
                            >
                              {locale === "ko"
                                ? "팬 인증하고 LIVE 참여하기"
                                : "Verify your fandom and join the LIVE"}
                            </FanAction>
                          </>
                        ) : (
                          <Link href={ifewLiveHref(locale)}>
                            {locale === "ko"
                              ? "이퓨 LIVE 자세히 보기"
                              : "View the ifew LIVE"}
                          </Link>
                        )}
                      </>
                    )}
                </div>
              ) : (
                <>
                  <label className={styles.entryAmount}>
                <span>{c.entryAmount}</span>
                <input
                  aria-label={c.entryAmount}
                  type="number"
                  min={1}
                  max={Math.min(
                    benefit.entry.creatorTicketBalance,
                        benefit.entry.remainingBenefitTickets ??
                          Number.MAX_SAFE_INTEGER,
                  )}
                  step={1}
                  value={entryAmount}
                  onChange={(event) => setEntryAmount(event.target.value)}
                />
              </label>
              <FanAction
                variant="primary"
                disabled={
                  pending ||
                  !Number.isInteger(Number(entryAmount)) ||
                      benefit.entry.creatorTicketBalance <
                        Number(entryAmount) ||
                  Number(entryAmount) <= 0 ||
                  !benefit.entry.canEnter ||
                  (benefit.entry.remainingBenefitTickets !== null &&
                        benefit.entry.remainingBenefitTickets <
                          Number(entryAmount))
                }
                ariaBusy={pending}
                    onClick={() => setEntryConfirmation(Number(entryAmount))}
                trailingIcon={<ArrowRight />}
              >
                    {!benefit.entry.canEnter
                      ? c.entryClosed
                      : benefit.entry.creatorTicketBalance === 0
                        ? c.entryZero
                        : benefit.entry.remainingBenefitTickets === 0
                          ? c.entryLimitReached
                          : c.enter}
              </FanAction>
                </>
              )}
              {(entryResult || benefit.entry.entries.length > 0) && (
                <div>
                  <h3>{c.entryHistory}</h3>
                  <ul>
                    {benefit.entry.entries.map((entry) => (
                      <li key={entry.entryId}>
                        {entry.ticketAmount}{" "}
                        {locale === "ko" ? "응모" : "entries"} ·{" "}
                        {formatDate(entry.enteredAt, locale)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <EntryConfirmationOverlay
              open={entryConfirmation !== null}
              onClose={() => setEntryConfirmation(null)}
              labelledBy="entry-confirm-title"
              describedBy="entry-confirm-description"
              backdropClassName={styles.entryConfirmBackdrop}
              contentClassName={styles.entryConfirmPanel}
              busy={pending}
              closeOnBackdrop={!pending}
              closeOnEscape={!pending}
            >
              <div className={styles.entryConfirmHeader}>
                <div>
                  <h2 id="entry-confirm-title">{c.entryConfirmTitle}</h2>
                  <p id="entry-confirm-description">{c.entryConfirmHelp}</p>
                </div>
                <button
                  type="button"
                  aria-label={locale === "ko" ? "닫기" : "Close"}
                  disabled={pending}
                  onClick={() => setEntryConfirmation(null)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <dl className={styles.entryConfirmSummary}>
                <div>
                  <dt>{c.entryCurrentBalance}</dt>
                  <dd>{benefit.entry.creatorTicketBalance}</dd>
                </div>
                <div>
                  <dt>{c.entryDebit}</dt>
                  <dd>-{entryConfirmation ?? 0}</dd>
                </div>
                <div>
                  <dt>{c.entryRemainingBalance}</dt>
                  <dd>
                    {benefit.entry.creatorTicketBalance -
                      (entryConfirmation ?? 0)}
                  </dd>
                </div>
              </dl>
              <div className={styles.entryConfirmActions}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setEntryConfirmation(null)}
                >
                  {c.entryCancel}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    entryConfirmation !== null &&
                    void enterBenefit(entryConfirmation)
                  }
                >
                  {pending ? c.entering : c.entryConfirm}
                </button>
              </div>
            </EntryConfirmationOverlay>
          </section>
        ) : deliveredClaim ? (
          <section className={styles.delivery} aria-live="polite">
            <Check aria-hidden="true" />
            <div>
              <h2>{c.delivered}</h2>
              {deliveredClaim.deliveryType === "external_url" ? (
                <a
                  href={deliveredClaim.deliveryValue}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${c.open}: ${benefit.title}, ${locale === "ko" ? "새 창" : "new window"}`}
                >
                  {c.open}
                  <ExternalLink aria-hidden="true" />
                </a>
              ) : deliveredClaim.deliveryType === "text" ? (
                <div className={styles.deliveredText}>
                  <span>{c.text}</span>
                  <p>{deliveredClaim.deliveryValue}</p>
                </div>
              ) : (
                <div className={styles.secret}>
                  <span>{c.code}</span>
                  <code data-wrap-anywhere>{deliveredClaim.deliveryValue}</code>
                  <button
                    type="button"
                    onClick={() => void copyCode(deliveredClaim.deliveryValue)}
                    aria-label={c.copy}
                  >
                    <Copy aria-hidden="true" />
                    {copied ? c.copied : c.copy}
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : !authenticated &&
          benefit.state !== "sold_out" &&
          benefit.state !== "expired" ? (
          <AuthIntentLink
            className={fanActionClassName("primary")}
            emphasis="primary"
            locale={locale}
            input={{
              sourcePath: `/benefits/${benefitId}`,
              sourceQuery: `?locale=${locale}${celebrity ? `&celebrity=${encodeURIComponent(celebrity)}` : ""}`,
              actionType:
                benefit.allocationMode === "application_selection"
                  ? "APPLY_BENEFIT"
                  : "CLAIM_BENEFIT",
              targetType: "benefit",
              targetId: benefitId,
            }}
          >
            {c.signIn}
          </AuthIntentLink>
        ) : benefit.allocationMode === "application_selection" &&
          (application?.status ?? benefit.applicationStatus) ? (
          <div className={styles.unavailable} role="status">
            <TicketCheck aria-hidden="true" />
            {
              c.applicationStates[
                (application?.status ??
                  benefit.applicationStatus) as keyof typeof c.applicationStates
              ]
            }
          </div>
        ) : benefit.state === "eligible" ? (
          <FanAction
            variant="primary"
            disabled={pending}
            ariaBusy={pending}
            onClick={() =>
              void (benefit.allocationMode === "application_selection"
                ? applyForBenefit()
                : claimBenefit())
            }
            trailingIcon={<ArrowRight />}
          >
            {pending
              ? benefit.allocationMode === "application_selection"
                ? c.applying
                : c.claiming
              : benefit.allocationMode === "application_selection"
                ? c.apply
                : c.claim}
          </FanAction>
        ) : (
          <div className={styles.unavailable} role="status">
            <LockKeyhole aria-hidden="true" />
            {unavailableCopy}
          </div>
        )}
        {actionError && (
          <p className={styles.actionError} role="alert">
            {benefit.entry
              ? c.entryError
              : benefit.allocationMode === "application_selection"
                ? c.applyError
                : c.claimError}
          </p>
        )}
      </article>
    </FanContentContainer>
  );
  if (presentation === "overlay") return detailContent;
  return (
    <FanAppFrame locale={locale} mainId="benefit-content">
      <div className={styles.page}>{detailContent}</div>
    </FanAppFrame>
  );
}

function useMobileBenefitOverlay() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 47.999rem)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function BenefitDetailOverlay({
  benefitId,
  locale,
  celebrity,
}: {
  benefitId: string;
  locale: BenefitLocale;
  celebrity?: string;
}) {
  const router = useRouter();
  const mobile = useMobileBenefitOverlay();
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    if (!busy) router.back();
  }, [busy, router]);
  const Overlay = mobile ? BottomSheet : Drawer;
  return (
    <Overlay
      open
      onClose={close}
      labelledBy="benefit-overlay-title"
      backdropClassName={styles.overlayBackdrop}
      contentClassName={styles.overlayPanel}
      busy={busy}
    >
      <header className={styles.overlayHeader}>
        <h2 id="benefit-overlay-title">
          {locale === "ko" ? "혜택 정보" : "Benefit details"}
        </h2>
        <button
          type="button"
          aria-label={
            locale === "ko" ? "혜택 정보 닫기" : "Close benefit details"
          }
          data-autofocus
          disabled={busy}
          onClick={close}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <BenefitDetailScreen
        benefitId={benefitId}
        locale={locale}
        celebrity={celebrity}
        presentation="overlay"
        onBusyChange={setBusy}
      />
    </Overlay>
  );
}
