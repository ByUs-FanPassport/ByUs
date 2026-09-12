"use client";

import { LiveTimeIndicator } from "./live-time-indicator";
import { liveWatchHref } from "../domain/live-watch-link";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  LockKeyhole,
  Play,
  Radio,
  Stamp,
  TicketCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  liveEventResponseSchema,
  type LiveEventResponse,
} from "@/features/live/domain/live-event";
import {
  ifewLiveSlug,
  ifewEndedDescription,
  ifewRafflesHref,
  ifewPrizeName,
} from "@/features/live/domain/ifew-event";
import { elinaLiveSlug, elinaRafflesHref } from "@/features/live/domain/elina-event";
import {
  buildAuthLoginHref,
  consumeAuthIntent,
  createAuthIntent,
  persistAuthIntent,
  readAuthIntent,
} from "@/components/auth-intent";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { withLocalePath } from "@/components/locale-path";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import {
  FanAction,
  fanActionClassName,
} from "@/components/fan-ui/fan-action";
import { FanActivityCompletionSummary } from "@/components/fan-ui/fan-activity-completion-summary";
import { EventPhoto } from "@/components/fan-ui/event-photo";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";
import { FanMotionIcon } from "@/components/fan-ui/fan-motion-icon";
import { ActivePreviewVideo } from "@/components/active-preview-video";
import { formatFanCount } from "@/components/fan-ui/fan-count";
import {
  createLiveAttendanceResponseSchema,
  isNormalizedFanCodeValid,
  normalizeFanCode,
  type CreateLiveAttendanceResponse,
} from "@/features/live/domain/live-attendance";
import { createLiveReservationResponseSchema } from "@/features/live/domain/live-reservation";
import type { FanActivityCompletion } from "@/features/live/domain/fan-activity-completion";
import { collectibleClaimSchema, type CollectibleOwnedState } from "@/features/collectible/domain/collectible";
import { levelLabel } from "@/features/passport/domain/passport-read-model";
import {
  enablePushNotifications,
  type PushEnableResult,
} from "@/features/notification/ui/push-subscription";
import {
  pageViewIdempotencyKey,
  recordProductEventV1,
} from "@/features/analytics/client/product-event-client";
import {
  reportRecoveryFailure,
  withOperationDeadline,
  withRequestDeadline,
} from "@/features/reliability/client/request-deadline";
import { getSessionStorage } from "@/features/reliability/client/session-storage";
import styles from "./live-event-screen.module.css";

type Locale = "ko" | "en";
type ViewState =
  | { kind: "loading" }
  | { kind: "error"; notFound: boolean }
  | { kind: "ready"; data: LiveEventResponse };

const copy = {
  ko: {
    nav: ["홈", "셀럽", "라이브", "패스포트", "혜택"],
    back: "라이브",
    scheduled: "예정",
    live: "LIVE",
    ended: "종료",
    cancelled: "취소",
    introduction: "LIVE 소개",
    howTo: "참여 방법",
    benefit: "LIVE 혜택",
    benefitIntro: "LIVE에 참여하고, 최애와 함께한 순간을 기록과 혜택으로 남겨보세요.",
    fanCode: "Fan Code",
    fanCodeHelper:
      "LIVE에서 공개된 Fan Code를 입력하면 예약 여부와 관계없이 출석을 남길 수 있어요.",
    attendance: {
      label: "Fan Code 입력",
      placeholder: "영문·숫자 4자 이상",
      submit: "출석 인증하기",
      pending: "출석 확인 중",
      signIn: "로그인하고 출석 인증하기",
      passport: "Fan Passport 발급 후 참여할 수 있어요.",
      issuePassport: "Fan Passport 발급받기",
      beforeLive: "Fan Code는 LIVE 시작 후 입력할 수 있어요.",
      notOpen: "아직 출석 인증 시간이 아니에요.",
      attendanceEnded: "출석 인증 시간이 종료되었어요.",
      invalid:
        "Fan Code가 올바르지 않아요. LIVE에서 공개된 코드를 다시 확인해 주세요.",
      format: "영문과 숫자로 4자 이상 입력해 주세요.",
      rateLimited: "입력 횟수를 초과했어요. {time} 후 다시 시도해 주세요.",
      unavailable:
        "지금은 출석을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
      wallet: "Passport 준비가 끝나지 않았어요. 잠시 후 다시 시도해 주세요.",
      successTitle: "LIVE 출석을 남겼어요",
      successHelper: "Attendance Stamp, Fan Score +3, 응모권 2장이 기록되었습니다.",
      replay: "이미 완료한 출석 기록을 안전하게 확인했어요.",
      survey: "설문 참여하고 다음 Stamp 받기",
    },
    steps: ["예약", "LIVE 시청", "Fan Code", "설문", "Stamp"],
    stepHelpers: [
      "일정을 먼저 저장해요",
      "새 탭에서 시청해요",
      "LIVE 시작 후 입력해요",
      "출석 완료 후 참여해요",
      "참여 기록을 남겨요",
    ],
    action: {
      reservation_upcoming: "예약 오픈 전",
      sign_in_to_reserve: "로그인하기",
      verify_fan: "팬 인증하기",
      reserve: "LIVE 예약하기",
      reserved: "예약 완료",
      watch_live: "LIVE 보러가기",
      reservation_closed: "예약 마감",
      live_ended: "종료된 LIVE",
      live_cancelled: "취소된 LIVE",
    },
    actionHelper: {
      signIn: "LIVE를 예약하려면 먼저 로그인해 주세요.",
      verifyFan: "예약하려면 {celebrity} Fan Passport가 필요해요.",
      watch: "외부 LIVE가 새 창에서 열려요.",
    },
    reservationPeriod: "예약 기간",
    eventTime: "LIVE 일정",
    timeZone: "기준 시간 KST (GMT+9)",
    reservePending: "예약 처리 중",
    reserveError:
      "예약을 완료하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.",
    reserveUnknown:
      "예약 결과를 아직 확인하지 못했어요. 같은 예약 요청을 다시 확인해 주세요.",
    loadError: "LIVE 정보를 불러오지 못했어요.",
    loadErrorHelper: "잠시 후 다시 시도하거나 라이브 목록으로 돌아가 주세요.",
    notFound: "공개된 LIVE를 찾을 수 없어요.",
    retry: "다시 불러오기",
    calendar: "Google Calendar에 추가",
    watch: "LIVE 보러가기",
    newWindow: "새 창",
    reservedTitle: "예약이 완료되었습니다",
    reservedHelper: "일정을 저장하고 LIVE가 시작되면 다시 만나요.",
    stampIssued: "Reservation Stamp 적립 완료",
    continue: "계속 보기",
    close: "예약 완료 창 닫기",
  },
  en: {
    nav: ["Home", "Celebrities", "Live", "Passports", "Benefits"],
    back: "Live",
    scheduled: "UPCOMING",
    live: "LIVE",
    ended: "ENDED",
    cancelled: "CANCELLED",
    introduction: "About this LIVE",
    howTo: "How to join",
    benefit: "LIVE benefit",
    benefitIntro: "Join a LIVE and turn moments with your favorite creator into lasting records and benefits.",
    fanCode: "Fan Code",
    fanCodeHelper:
      "Enter the Fan Code shared during the LIVE to record attendance—no reservation required.",
    attendance: {
      label: "Enter Fan Code",
      placeholder: "4+ letters or numbers",
      submit: "Verify attendance",
      pending: "Checking attendance",
      signIn: "Sign in to verify attendance",
      passport: "Create a Fan Passport before joining.",
      issuePassport: "Get your Fan Passport",
      beforeLive: "You can enter the Fan Code once the LIVE starts.",
      notOpen: "Attendance verification is not open yet.",
      attendanceEnded: "Attendance verification has ended.",
      invalid:
        "That Fan Code isn’t valid. Check the code shared during the LIVE.",
      format: "Enter at least 4 letters or numbers.",
      rateLimited: "Too many attempts. Try again in {time}.",
      unavailable: "Attendance can’t be verified right now. Try again shortly.",
      wallet: "Your Passport is still getting ready. Try again shortly.",
      successTitle: "Your LIVE attendance is recorded",
      successHelper: "You earned an Attendance Stamp, +3 Fan Score, and 2 raffle tickets.",
      replay: "Your completed attendance record was safely retrieved.",
      survey: "Take the survey for your next Stamp",
    },
    steps: ["Reserve", "Watch LIVE", "Fan Code", "Survey", "Stamp"],
    stepHelpers: [
      "Save the schedule",
      "Watch in a new tab",
      "Enter the code after the LIVE starts",
      "Available after attendance",
      "Keep your participation record",
    ],
    action: {
      reservation_upcoming: "Reservations open soon",
      sign_in_to_reserve: "Sign in",
      verify_fan: "Verify fan status",
      reserve: "Reserve a spot",
      reserved: "Reserved",
      watch_live: "Watch LIVE",
      reservation_closed: "Reservations closed",
      live_ended: "LIVE ended",
      live_cancelled: "LIVE cancelled",
    },
    actionHelper: {
      signIn: "Sign in first to reserve this LIVE.",
      verifyFan: "A {celebrity} Fan Passport is required to reserve.",
      watch: "Opens the external LIVE in a new window.",
    },
    reservationPeriod: "Reservation period",
    eventTime: "LIVE schedule",
    timeZone: "KST (UTC+9)",
    reservePending: "Reserving",
    reserveError:
      "We couldn’t complete your reservation. Check the status and try again.",
    reserveUnknown:
      "The reservation result is still unconfirmed. Check the same reservation request again.",
    loadError: "We couldn’t load this LIVE.",
    loadErrorHelper: "Try again shortly or return to all LIVE events.",
    notFound: "We couldn’t find this LIVE.",
    retry: "Try again",
    calendar: "Add to Google Calendar",
    watch: "Watch LIVE",
    newWindow: "new window",
    reservedTitle: "Your reservation is complete",
    reservedHelper: "Save the date and come back when the LIVE begins.",
    stampIssued: "Reservation Stamp earned",
    continue: "Keep browsing",
    close: "Close reservation confirmation",
  },
} as const;

const ifewLiveCopy = {
  ko: {
    fanCode: "출석 코드",
    fanCodeHelper:
      "LIVE 방송에서 알려주는 출석 코드를 이 화면에 입력하면 ByUs에 출석을 남길 수 있어요.",
    attendance: {
      label: "출석 코드 입력",
      beforeLive:
        "LIVE가 시작되면 방송에서 알려주는 출석 코드를 이 화면에 입력해 주세요.",
      invalid:
        "출석 코드가 올바르지 않아요. LIVE 방송에서 알려준 코드를 다시 확인해 주세요.",
      successHelper:
        "LIVE 출석이 기록되고 이퓨 응모권 2장을 받았어요.",
    },
    steps: ["팬 인증", "LIVE 예약", "LIVE 출석", "선물 응모"],
    stepHelpers: [
      "이퓨 Fan Passport를 발급받아요",
      "일정을 미리 저장해요. 예약은 선택이에요",
      "방송에서 공개된 출석 코드를 ByUs에 입력해요",
      "이퓨 응모권으로 뱅크시 관람권 추첨에 응모해요",
    ],
    prizeAction: "뱅크시 관람권 추첨 응모하기",
    prizeHelper: `${ifewPrizeName.ko} 추첨 페이지로 이동해요.`,
  },
  en: {
    fanCode: "Attendance code",
    fanCodeHelper:
      "Enter the attendance code shared during the LIVE here to record your attendance on ByUs.",
    attendance: {
      label: "Enter attendance code",
      beforeLive:
        "Once the LIVE starts, enter the attendance code shared during the broadcast here.",
      invalid:
        "That attendance code isn’t valid. Check the code shared during the LIVE.",
      successHelper:
        "Your LIVE attendance is recorded, and you received 2 ifew raffle tickets.",
    },
    steps: ["Fan verification", "Reserve", "LIVE attendance", "Enter the prize draw"],
    stepHelpers: [
      "Get your ifew Fan Passport",
      "Save the schedule. Reservation is optional",
      "Enter the broadcast’s attendance code on ByUs",
      "Use your ifew raffle tickets to enter the Banksy ticket draw",
    ],
    prizeAction: "Enter the Banksy ticket draw",
    prizeHelper: `Go to the draw for ${ifewPrizeName.en}.`,
  },
} as const;

type AttendanceState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; code: string }
  | { kind: "rate-limited"; retryAt: number }
  | {
      kind: "success";
      result: CreateLiveAttendanceResponse;
      replayed: boolean;
    };

class ReservationResponseError extends Error {
  constructor(readonly status: number) {
    super("Reservation response rejected");
  }
}

function formatRetry(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDateTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Compare calendar days in the same timezone used by the displayed LIVE schedule.
export function formatReservationDeadline(closesAt: string, startsAt: string, locale: Locale) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  if (day.format(new Date(closesAt)) !== day.format(new Date(startsAt))) {
    return formatReservationDateTime(closesAt, locale);
  }
  const time = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", hour12: locale !== "ko",
  }).format(new Date(closesAt));
  return `${locale === "ko" ? "당일" : "Same day"} ${time}`;
}

/** Compact schedule keeps the year and KST explicit; no browser-timezone dependence. */
export function formatReservationDateTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: "Asia/Seoul", year:"numeric", month:"short", day:"numeric",
    weekday:"short", hour:"numeric", minute:"2-digit", hour12:locale !== "ko",
  }).format(new Date(iso));
}

function externalActionLabel(action: string, target: string, locale: Locale) {
  return `${action}: ${target}, ${copy[locale].newWindow}`;
}

function googleCalendarUrl(data: LiveEventResponse["live"]) {
  const compact = (iso: string) =>
    new Date(iso).toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: data.title,
    dates: `${compact(data.startsAt)}/${compact(data.endsAt)}`,
    details: `${data.description}\n\n${data.brand.name}`,
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

function ReservationDialog({
  data,
  completion,
  locale,
  onClose,
  getAccessToken,
}: {
  data: LiveEventResponse;
  completion: FanActivityCompletion;
  locale: Locale;
  onClose: () => void;
  getAccessToken: () => Promise<string | null>;
}) {
  const c = copy[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pushState, setPushState] = useState<PushEnableResult | null>(null);
  const [pushPending, setPushPending] = useState(false);
  const isElinaReservation = data.live.slug === elinaLiveSlug;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose, { once: true });
    return () => {
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="reservation-title"
    >
      <button
        ref={closeRef}
        className={styles.dialogClose}
        type="button"
        onClick={() => dialogRef.current?.close()}
        aria-label={c.close}
      >
        <X aria-hidden="true" />
      </button>
      <FanActivityCompletionSummary
        locale={locale}
        stampType="reservation"
        title={c.reservedTitle}
        description={isElinaReservation
          ? locale === "ko" ? "보유 응모권으로 지금 원하는 선물에 직접 응모할 수 있어요." : "Use your raffle tickets to enter for your favorite prize now."
          : c.reservedHelper}
        headingId="reservation-title"
        scoreDelta={completion.scoreDelta}
        updatedScore={completion.updatedScore}
        updatedLevel={levelLabel(locale, completion.updatedLevel)}
        leveledUp={completion.leveledUp}
        passportHref={`/passports/${completion.passportId}?locale=${locale}`}
      />
      <div className={styles.dialogEvent}>
        <strong>{data.live.title}</strong>
        <span>
          <FanMotionIcon name="calendar" />
          {formatDateTime(data.live.startsAt, locale)}
        </span>
      </div>
      <a
        className={styles.dialogSecondary}
        href={googleCalendarUrl(data.live)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={externalActionLabel(c.calendar, data.live.title, locale)}
      >
        <FanMotionIcon name="calendar" />
        {c.calendar}
      </a>
      <button
        className={styles.dialogSecondary}
        type="button"
        disabled={pushPending || pushState === "subscribed"}
        onClick={async () => {
          setPushPending(true);
          try {
            setPushState(await enablePushNotifications(getAccessToken));
          } finally {
            setPushPending(false);
          }
        }}
      >
        <Bell aria-hidden="true" />
        {pushState === "subscribed"
          ? locale === "ko"
            ? "알림 켜짐"
            : "Notifications on"
          : pushState === "failed"
            ? locale === "ko" ? "알림 설정 다시 시도" : "Retry notification setup"
          : locale === "ko"
            ? "시작 알림 받기"
            : "Enable reminders"}
      </button>
      {pushState && pushState !== "subscribed" && (
        <p className={styles.pushMessage} role="status">
          {pushState === "denied"
            ? locale === "ko"
              ? "브라우저 설정에서 알림 권한을 허용해 주세요."
              : "Allow notifications in browser settings."
            : pushState === "unsupported"
              ? locale === "ko"
                ? "이 브라우저는 푸시 알림을 지원하지 않습니다."
                : "This browser does not support push notifications."
              : locale === "ko"
                ? "알림 설정을 저장하지 못했어요. 다시 시도해 주세요. LIVE 예약은 완료됐어요."
                : "Could not save notification settings. Please try again. Your LIVE reservation is complete."}
        </p>
      )}
      {isElinaReservation ? (
        <FanAction variant="primary" className={styles.dialogPrimary} fullWidth href={elinaRafflesHref(locale)}>
          {locale === "ko" ? "선물 고르고 응모하기" : "Choose a prize and enter"}
        </FanAction>
      ) : (
        <FanAction variant="primary" className={styles.dialogPrimary} fullWidth onClick={() => dialogRef.current?.close()}>
          {c.continue}
        </FanAction>
      )}
    </dialog>
  );
}

export function LiveEventScreen({
  slug,
  locale,
  initialData,
}: {
  slug: string;
  locale: Locale;
  initialData?: LiveEventResponse;
}) {
  const c = copy[locale];
  const { ready: authReady, authenticated, getAccessToken, user } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<ViewState>(() => initialData ? { kind: "ready", data: initialData } : { kind: "loading" });
  const [reservePending, setReservePending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [reservationCompletion, setReservationCompletion] =
    useState<FanActivityCompletion | null>(null);
  const [fanCode, setFanCode] = useState("");
  const [attendance, setAttendance] = useState<AttendanceState>({
    kind: "idle",
  });
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [collectible, setCollectible] = useState<CollectibleOwnedState | null>(null);
  const [collectiblePending, setCollectiblePending] = useState(false);
  const [collectibleError, setCollectibleError] = useState<string | null>(null);
  const fanCodeRef = useRef<HTMLElement>(null);
  const fanCodeInputRef = useRef<HTMLInputElement>(null);
  const attendanceKeyRef = useRef<string | null>(null);
  const attendanceAttemptsRef = useRef(0);
  const resumedIntentRef = useRef<string | null>(null);
  const liveReadController = useRef<AbortController | null>(null);
  const reservationControllerRef = useRef<AbortController | null>(null);
  const reservationOperationRef = useRef<Promise<void> | null>(null);
  const reservationGenerationRef = useRef(0);

  useEffect(() => {
    reservationGenerationRef.current += 1;
    reservationControllerRef.current?.abort();
    reservationOperationRef.current = null;
    setReservePending(false);
    setActionError(null);
    setShowConfirmation(false);
    setReservationCompletion(null);
    return () => {
      reservationGenerationRef.current += 1;
      reservationControllerRef.current?.abort();
      reservationOperationRef.current = null;
    };
  }, [authenticated, slug, user?.id]);

  const load = useCallback(async (background = false, trackPageView = !background) => {
    if (!authReady) return;
    if (authenticated && !user?.id) return;
    liveReadController.current?.abort();
    const controller = new AbortController();
    liveReadController.current = controller;
    if (!background) setView({ kind: "loading" });
    try {
      const token = authenticated ? await withOperationDeadline(getAccessToken()) : null;
      if (controller.signal.aborted) return;
      const result = await withRequestDeadline(async (signal) => {
        const response = await fetch(
          `/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`,
          { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : undefined, cache: "no-store", signal },
        );
        if (!response.ok) return { ok: false as const, status: response.status };
        return { ok: true as const, data: liveEventResponseSchema.parse(await response.json()) };
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        if (!background) setView({ kind: "error", notFound: result.status === 404 });
        return;
      }
      const data = result.data;
      if (controller.signal.aborted) return;
      setCollectible(data.viewer.collectible ?? null);
      setView({ kind: "ready", data });
      if (trackPageView) void (async () => {
        if (controller.signal.aborted) return;
        const ownerId = token ? user?.id : null;
        if (token && !ownerId) return;
        const idempotencyKey = await pageViewIdempotencyKey(
          "live_page_view",
          `/live/${data.live.id}`,
          ownerId ?? null,
        );
        if (controller.signal.aborted) return;
        await recordProductEventV1(
          {
            eventName: "live_page_view",
            celebrityId: null,
            liveEventId: data.live.id,
            missionId: null,
            benefitId: null,
            source: "fan.live.detail",
            idempotencyKey,
            properties: { provider: data.live.watch.provider },
          },
          token,
        );
      })().catch(() => undefined);
    } catch (error) {
      reportRecoveryFailure("live.load", error);
      if (!controller.signal.aborted && !background) setView({ kind: "error", notFound: false });
    }
  }, [authReady, authenticated, getAccessToken, locale, slug, user?.id]);

  useEffect(() => {
    // SSR data already fills the page. Refresh viewer-specific state without
    // replacing the full document with a loading skeleton during hydration.
    void load(Boolean(initialData), true);
    return () => liveReadController.current?.abort();
  }, [initialData, load]);
  const refreshLiveStatus = useCallback(() => { void load(true); }, [load]);

  const claimCollectible = useCallback(async () => {
    if (!collectible?.eligible || collectiblePending) return;
    setCollectiblePending(true); setCollectibleError(null);
    try {
      const token = await getAccessToken(); if (!token) throw new Error();
      const storageKey = `byus:collectible-claim:${slug}:${user?.id ?? "unknown-owner"}`;
      const idempotencyKey = window.sessionStorage.getItem(storageKey) ?? window.crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, idempotencyKey);
      const response = await fetch(`/api/live-events/${encodeURIComponent(slug)}/collectible`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey }) });
      if (!response.ok) throw new Error();
      const result = await response.json() as { claim?: unknown };
      const claim = collectibleClaimSchema.parse(result.claim);
      window.sessionStorage.removeItem(storageKey);
      setCollectible({ ...collectible, eligible: false, claim });
    } catch { setCollectibleError(locale === "ko" ? "Collectible을 받지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요." : "Could not claim the Collectible. Check the status and try again."); }
    finally { setCollectiblePending(false); }
  }, [collectible, collectiblePending, getAccessToken, locale, slug, user]);

  useEffect(() => {
    if (view.kind !== "ready" || window.location.hash !== "#fan-code") return;
    const target = fanCodeRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    target.dataset.returnFocus = "true";
    const timeout = window.setTimeout(() => {
      delete target.dataset.returnFocus;
    }, 2400);
    return () => window.clearTimeout(timeout);
  }, [view]);

  useEffect(() => {
    if (attendance.kind !== "rate-limited") return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((attendance.retryAt - Date.now()) / 1000),
      );
      setRetrySeconds(remaining);
      if (remaining === 0) setAttendance({ kind: "idle" });
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [attendance]);

  const reserve = useCallback(() => {
    if (view.kind !== "ready") return Promise.resolve();
    if (reservationOperationRef.current) return reservationOperationRef.current;
    const ownerId = user?.id;
    if (!ownerId) {
      setActionError(c.reserveError);
      return Promise.resolve();
    }
    const eventId = view.data.live.id;
    const originalData = view.data;
    const generation = reservationGenerationRef.current;
    const isCurrent = () => generation === reservationGenerationRef.current;
    const operation = (async () => {
      liveReadController.current?.abort();
      reservationControllerRef.current?.abort();
      const controller = new AbortController();
      reservationControllerRef.current = controller;
      setReservePending(true);
      setActionError(null);
      const storageKey = `byus:live-reservation:${encodeURIComponent(ownerId)}:${eventId}`;
      let idempotencyKey: string;
      let existingRequest = false;
      const clearReservationKey = () => {
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch (error) {
          reportRecoveryFailure("storage.write", error);
        }
      };
      try {
        existingRequest = window.sessionStorage.getItem(storageKey) !== null;
        idempotencyKey = window.sessionStorage.getItem(storageKey) ?? window.crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      } catch (error) {
        reportRecoveryFailure("storage.write", error);
        if (isCurrent()) setActionError(c.reserveError);
        return;
      }
      let token: string | null = null;
      try {
        token = await withOperationDeadline(getAccessToken());
        if (!token) throw new Error("Missing reservation token");
        const reservationResult = await withRequestDeadline(async (signal) => {
          const response = await fetch(`/api/live-events/${encodeURIComponent(eventId)}/reservation`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ idempotencyKey }), signal,
          });
          if (!response.ok) throw new ReservationResponseError(response.status);
          return createLiveReservationResponseSchema.parse(await response.json());
        }, { signal: controller.signal });
        if (!isCurrent()) return;

        clearReservationKey();
        setView({
          kind: "ready",
          data: {
            ...originalData,
            viewer: { ...originalData.viewer, reservation: reservationResult.reservation },
            primaryAction: "reserved",
          },
        });
        setReservationCompletion(reservationResult.completion);
        setShowConfirmation(true);
        setReservePending(false);

        try {
          const refreshController = new AbortController();
          reservationControllerRef.current = refreshController;
          const data = await withRequestDeadline(async (signal) => {
            const refreshed = await fetch(`/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`, {
              method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal,
            });
            if (!refreshed.ok) throw new Error("Reservation refresh failed");
            return liveEventResponseSchema.parse(await refreshed.json());
          }, { signal: refreshController.signal });
          if (isCurrent() && data.viewer.reservation) setView({ kind: "ready", data });
        } catch (error) {
          reportRecoveryFailure("reservation.reconcile", error);
        }
        return;
      } catch (error) {
        reportRecoveryFailure("reservation.submit", error);
        if (!isCurrent()) return;
        if (error instanceof ReservationResponseError && error.status >= 400 && error.status < 500 && !existingRequest) {
          clearReservationKey();
          setActionError(c.reserveError);
          return;
        }
      }

      try {
        const reconciliationController = new AbortController();
        reservationControllerRef.current = reconciliationController;
        if (!token) token = await withOperationDeadline(getAccessToken());
        if (!token) throw new Error("Missing reconciliation token");
        const current = await withRequestDeadline(async (signal) => {
          const response = await fetch(`/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`, {
            method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal,
          });
          if (!response.ok) throw new Error("Reservation reconciliation failed");
          return liveEventResponseSchema.parse(await response.json());
        }, { signal: reconciliationController.signal });
        if (!isCurrent()) return;
        setView({ kind: "ready", data: current });
        if (current.viewer.reservation) {
          clearReservationKey();
          setActionError(null);
        } else {
          setActionError(c.reserveUnknown);
        }
      } catch (error) {
        reportRecoveryFailure("reservation.reconcile", error);
        if (isCurrent()) setActionError(c.reserveUnknown);
      }
    })();
    reservationOperationRef.current = operation;
    void operation.finally(() => {
      if (reservationOperationRef.current === operation) reservationOperationRef.current = null;
      if (reservationControllerRef.current && isCurrent()) reservationControllerRef.current = null;
      if (isCurrent()) setReservePending(false);
    });
    return operation;
  }, [c.reserveError, c.reserveUnknown, getAccessToken, locale, slug, user?.id, view]);

  function rememberWatchReturn() {
    const query = searchParams.toString();
    getSessionStorage().setItem(
      "byus:live-return",
      JSON.stringify({
        route: `${pathname}${query ? `?${query}` : ""}#fan-code`,
        scrollY: window.scrollY,
        liveId: view.kind === "ready" ? view.data.live.id : null,
      }),
    );
    if (view.kind === "ready") {
      void getAccessToken().then((token) =>
        recordProductEventV1(
          {
            eventName: "live_cta_click",
            celebrityId: null,
            liveEventId: view.data.live.id,
            missionId: null,
            benefitId: null,
            source: "fan.live.watch_cta",
            idempotencyKey: `cta:live:${view.data.live.id}:${window.crypto.randomUUID()}`,
            properties: {
              provider: view.data.live.watch.provider,
              liveEventId: view.data.live.id,
            },
          },
          token,
        ),
      );
    }
  }

  const submitAttendance = useCallback(async (rawCode: string) => {
    if (
      view.kind !== "ready" ||
      attendance.kind === "pending" ||
      attendance.kind === "rate-limited"
    )
      return;
    const normalizedCode = normalizeFanCode(rawCode);
    if (!isNormalizedFanCodeValid(normalizedCode)) {
      setFanCode("");
      setAttendance({ kind: "error", code: "FORMAT" });
      window.requestAnimationFrame(() => fanCodeInputRef.current?.focus());
      return;
    }

    if (!authenticated) {
      const draftRef = `byus:fan-code-draft:${slug}`;
      getSessionStorage().setItem(draftRef, normalizedCode);
      const intent = createAuthIntent({
        sourcePath: `/live/${slug}`,
        sourceQuery: `?locale=${locale}`,
        returnAnchor: "#fan-code",
        actionType: "SUBMIT_FAN_CODE",
        targetType: "live_event",
        targetId: slug,
        draftPayload: { draftRef },
      });
      persistAuthIntent(getSessionStorage(), intent);
      router.push(buildAuthLoginHref(intent, locale) as Route);
      return;
    }

    setAttendance({ kind: "pending" });
    try {
      const token = await getAccessToken();
      if (!token) {
        setFanCode("");
        setAttendance({ kind: "error", code: "AUTHENTICATION_REQUIRED" });
        return;
      }
      const idempotencyKey =
        attendanceKeyRef.current ?? window.crypto.randomUUID();
      attendanceKeyRef.current = idempotencyKey;
      const replayedRequest = attendanceAttemptsRef.current > 0;
      attendanceAttemptsRef.current += 1;
      const response = await fetch(
        `/api/live-events/${encodeURIComponent(slug)}/attendance`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ code: normalizedCode }),
        },
      );
      if (response.ok) {
        const result = createLiveAttendanceResponseSchema.parse(
          await response.json(),
        );
        setFanCode("");
        attendanceKeyRef.current = null;
        attendanceAttemptsRef.current = 0;
        setAttendance({ kind: "success", result, replayed: replayedRequest });
        const intentId = searchParams.get("authIntent");
        if (intentId) consumeAuthIntent(getSessionStorage(), intentId);
        getSessionStorage().removeItem(`byus:fan-code-draft:${slug}`);
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      const errorCode = body?.error?.code ?? "ATTENDANCE_UNAVAILABLE";
      if (response.status === 429) {
        const retryAfter = Number.parseInt(
          response.headers.get("retry-after") ?? "900",
          10,
        );
        setFanCode("");
        attendanceKeyRef.current = null;
        attendanceAttemptsRef.current = 0;
        setAttendance({
          kind: "rate-limited",
          retryAt:
            Date.now() +
            (Number.isFinite(retryAfter) ? retryAfter : 900) * 1000,
        });
      } else {
        if (
          errorCode === "ATTENDANCE_CODE_INVALID" ||
          errorCode === "PASSPORT_REQUIRED" ||
          errorCode === "WALLET_NOT_READY"
        ) {
          setFanCode("");
          attendanceKeyRef.current = null;
          attendanceAttemptsRef.current = 0;
        }
        setAttendance({ kind: "error", code: errorCode });
        window.requestAnimationFrame(() => fanCodeInputRef.current?.focus());
      }
    } catch {
      setAttendance({ kind: "error", code: "ATTENDANCE_UNAVAILABLE" });
      window.requestAnimationFrame(() => fanCodeInputRef.current?.focus());
    }
  }, [attendance.kind, authenticated, getAccessToken, locale, router, searchParams, slug, view]);

  async function attend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAttendance(fanCode);
  }

  useEffect(() => {
    if (!authenticated || view.kind !== "ready") return;
    const intentId = searchParams.get("authIntent");
    if (!intentId) return;
    const intent = readAuthIntent(getSessionStorage(), intentId);
    if (!intent || intent.targetType !== "live_event" || intent.targetId !== slug) return;

    if (intent.actionType === "RESERVE_LIVE") {
      if (view.data.viewer.reservation) {
        consumeAuthIntent(getSessionStorage(), intentId);
        resumedIntentRef.current = intentId;
      } else if (view.data.primaryAction === "reserve" && resumedIntentRef.current !== intentId) {
        resumedIntentRef.current = intentId;
        void reserve();
      }
      return;
    }

    if (intent.actionType === "SUBMIT_FAN_CODE") {
      if (resumedIntentRef.current === intentId) return;
      const draftRef = typeof intent.draftPayload.draftRef === "string" ? intent.draftPayload.draftRef : null;
      const draft = draftRef ? getSessionStorage().getItem(draftRef) : null;
      if (!draft) return;
      resumedIntentRef.current = intentId;
      setFanCode(draft);
      void submitAttendance(draft);
    }
  }, [authenticated, reserve, searchParams, slug, submitAttendance, view]);

  if (view.kind === "loading") {
    return (
      <FanAppFrame locale={locale} mainId="live-detail-main" currentPath={`/live/${slug}`}>
        <div className={styles.page}>
        <FanContentContainer as="main"
          id="live-detail-main"
          tabIndex={-1}
          className={styles.loading}
          aria-busy="true"
          aria-label={locale === "ko" ? "LIVE 불러오는 중" : "Loading LIVE"}
        >
          <div />
          <div />
        </FanContentContainer>
        </div>
      </FanAppFrame>
    );
  }
  if (view.kind === "error") {
    return (
      <FanAppFrame locale={locale} mainId="live-detail-main" currentPath={`/live/${slug}`}>
        <div className={styles.page}>
        <FanContentContainer as="main" id="live-detail-main" className={styles.error} tabIndex={-1} role="alert">
          <Radio aria-hidden="true" />
          <h1>{view.notFound ? c.notFound : c.loadError}</h1>
          <p>{c.loadErrorHelper}</p>
          {!view.notFound && (
            <button type="button" onClick={() => void load()}>
              {c.retry}
            </button>
          )}
          <Link href={`/?locale=${locale}` as Route}>{c.nav[0]}</Link>
        </FanContentContainer>
        </div>
      </FanAppFrame>
    );
  }

  const data = view.data;
  const { live, viewer, primaryAction } = data;
  const watchHref = liveWatchHref(live, locale);
  const isIfewLive = live.slug === ifewLiveSlug;
  const isIfewClosed = isIfewLive && live.effectiveStatus === "ended";
  const isElinaLive = live.slug === elinaLiveSlug;
  const eventCopy = isIfewLive ? ifewLiveCopy[locale] : null;
  const attendanceCopy = eventCopy
    ? { ...c.attendance, ...eventCopy.attendance }
    : c.attendance;
  const elinaSteps = locale === "ko"
    ? ["팬 인증", "LIVE 예약", "선물 응모", "방송 당일 출석"]
    : ["Verify", "Reserve", "Enter for prizes", "LIVE check-in"];
  const elinaStepHelpers = locale === "ko"
    ? ["첫 인증으로 응모권 1장", "첫 예약으로 응모권 1장", "모은 응모권으로 직접 응모해요", "ByUs에 코드 입력하고 2장 추가"]
    : ["Earn 1 ticket on first verification", "Earn 1 ticket on first reservation", "Use your tickets to enter separately", "Return to ByUs, enter the code and earn 2"];
  const journeySteps = eventCopy?.steps ?? (isElinaLive ? elinaSteps : c.steps.filter((_, index) => live.missionsAvailable !== false || index !== 3));
  const journeyStepHelpers = eventCopy?.stepHelpers ?? (isElinaLive ? elinaStepHelpers : c.stepHelpers.filter((_, index) => live.missionsAvailable !== false || index !== 3));
  const statusLabel =
    live.effectiveStatus === "scheduled"
      ? c.scheduled
      : live.effectiveStatus === "live"
        ? c.live
        : live.effectiveStatus === "cancelled"
          ? c.cancelled
          : c.ended;
  const actionLabel = reservePending
    ? c.reservePending
    : c.action[primaryAction];
  const calendarUrl = googleCalendarUrl(live);
  const liveReturnQuery = new URLSearchParams({ locale });
  const authIntentId = searchParams.get("authIntent");
  if (authIntentId) liveReturnQuery.set("authIntent", authIntentId);
  const verificationQuery = new URLSearchParams({
    locale,
    returnTo: `/live/${slug}?${liveReturnQuery.toString()}`,
  });
  const verificationHref = `/c/${live.celebrity.slug}/verify?${verificationQuery.toString()}` as Route;
  const primaryHelper =
    primaryAction === "sign_in_to_reserve"
      ? c.actionHelper.signIn
      : primaryAction === "verify_fan"
        ? c.actionHelper.verifyFan.replace("{celebrity}", live.celebrity.name)
        : primaryAction === "watch_live"
          ? isIfewLive
            ? locale === "ko" ? "틱톡이 새 창에서 열려요. 시청 후 이 화면에서 출석 코드를 입력해 주세요." : "TikTok opens in a new tab. Return here to enter the attendance code."
            : c.actionHelper.watch
          : null;
  const primaryHelperId = primaryHelper ? "live-primary-action-helper" : undefined;
  const attendanceError =
    attendance.kind === "error"
      ? attendance.code === "ATTENDANCE_CODE_INVALID"
        ? attendanceCopy.invalid
        : attendance.code === "ATTENDANCE_NOT_OPEN"
          ? attendanceCopy.notOpen
          : attendance.code === "ATTENDANCE_ENDED"
            ? attendanceCopy.attendanceEnded
        : attendance.code === "FORMAT"
          ? attendanceCopy.format
          : attendance.code === "WALLET_NOT_READY"
            ? attendanceCopy.wallet
            : attendance.code === "PASSPORT_REQUIRED"
              ? attendanceCopy.passport
              : attendanceCopy.unavailable
      : attendance.kind === "rate-limited"
        ? attendanceCopy.rateLimited.replace("{time}", formatRetry(retrySeconds))
        : null;

  const primaryControl =
    primaryAction === "sign_in_to_reserve" ? (
      <div className={styles.primaryActionBlock}>
        <AuthIntentLink
          className={fanActionClassName("primary", { fullWidth: true })}
          emphasis="primary"
          locale={locale}
          ariaDescribedBy={primaryHelperId}
          input={{
            sourcePath: `/live/${slug}`,
            sourceQuery: `?locale=${locale}`,
            actionType: "RESERVE_LIVE",
            targetType: "live_event",
            targetId: slug,
          }}
        >
          <span className={styles.actionLeading} aria-hidden="true"><TicketCheck /></span>
          <span>{actionLabel}</span>
          <span className={styles.actionTrailing} aria-hidden="true"><ArrowRight /></span>
        </AuthIntentLink>
        <p id={primaryHelperId} className={styles.actionHelper}>{primaryHelper}</p>
      </div>
    ) : primaryAction === "verify_fan" ? (
      <div className={styles.primaryActionBlock}>
        <FanAction
          href={verificationHref}
          variant="primary"
          fullWidth
          ariaDescribedBy={primaryHelperId}
          leadingIcon={<TicketCheck />}
          trailingIcon={<ArrowRight />}
        >
          {actionLabel}
        </FanAction>
        <p id={primaryHelperId} className={styles.actionHelper}>
          {primaryHelper}
        </p>
      </div>
    ) : primaryAction === "watch_live" &&
      live.watch.available &&
      live.watch.url ? (
      <div className={styles.primaryActionBlock}>
        <FanAction
          href={watchHref}
          external
          variant="primary"
          fullWidth
          ariaDescribedBy={primaryHelperId}
          leadingIcon={<Play />}
          trailingIcon={<ExternalLink />}
          ariaLabel={externalActionLabel(actionLabel, live.title, locale)}
          onClick={rememberWatchReturn}
        >
          {actionLabel}
        </FanAction>
        <p id={primaryHelperId} className={styles.actionHelper}>
          {primaryHelper}
        </p>
      </div>
    ) : primaryAction === "reserve" ? (
      <div className={styles.primaryActionBlock}>
        <FanAction
          variant="primary"
          fullWidth
          disabled={reservePending}
          ariaBusy={reservePending}
          onClick={() => void reserve()}
          leadingIcon={<TicketCheck />}
          trailingIcon={<ArrowRight />}
        >
          {actionLabel}
        </FanAction>
      </div>
    ) : (
      <div className={styles.actionState}>
        <p className={styles.actionStatus} role="status" data-reserved={primaryAction === "reserved" || undefined}>
          {primaryAction === "reserved" ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
          <span>{actionLabel}</span>
        </p>
        {primaryAction === "reserved" ? <p className={styles.actionHelper}>
          {isIfewLive
            ? locale === "ko" ? "일정을 저장해 두세요. 방송이 시작되면 이 화면에서 출석 코드를 입력할 수 있어요." : "Save the schedule. When the LIVE starts, return here to enter the attendance code."
            : c.reservedHelper}
        </p> : null}
      </div>
    );
  const hasPrimaryActionControl =
    primaryAction === "sign_in_to_reserve" ||
    primaryAction === "verify_fan" ||
    primaryAction === "reserve" ||
    (primaryAction === "watch_live" &&
      live.watch.available &&
      Boolean(live.watch.url));

  return (
    <FanAppFrame locale={locale} mainId="live-detail-main" currentPath={`/live/${slug}`}>
      <div className={styles.page}>
      <FanContentContainer as="main" id="live-detail-main" className={styles.main} tabIndex={-1}>
        <Link className={styles.back} href={withLocalePath("/live", locale) as Route}>
          <ArrowLeft aria-hidden="true" />
          {c.back}
        </Link>
        <div className={styles.detailLayout}>
          <div className={styles.heroMedia}>
            <EventPhoto photos={live.photos} src={live.heroImage.url} alt={live.heroImage.alt} locale={locale} surface="detail" priority sizes="(min-width: 1440px) 960px, (min-width: 1024px) 66vw, calc(100vw - 32px)" />
            {live.preview ? (
              <ActivePreviewVideo
                id={live.id}
                mode="detail"
                locale={locale}
                preview={{
                  videoUrl: live.preview.landscape.videoUrl,
                  posterUrl: live.preview.landscape.posterUrl,
                  durationMs: live.preview.durationMs,
                }}
              />
            ) : null}
          </div>
          <div className={styles.detailAside}>
          <aside
            className={styles.actionRail}
            aria-label={
              locale === "ko" ? "LIVE 예약 정보" : "LIVE reservation details"
            }
          >
            <div className={styles.eventStatusRow}>
            {live.effectiveStatus === "scheduled" ? <span className={styles.status}>{locale === "ko" ? "LIVE 예정" : "Upcoming LIVE"}</span> : null}
            {live.effectiveStatus === "live" ||
            live.effectiveStatus === "scheduled" ? (
              <LiveTimeIndicator
                locale={locale}
                event={live}
                onStartReached={refreshLiveStatus}
              />
            ) : (
              <span className={styles.status} data-status={live.effectiveStatus}>
                {statusLabel}
              </span>
            )}
            </div>
            <div className={styles.titleGroup}>
              <h1>{live.title}</h1>
            </div>
            <div className={styles.scheduleGroup}>
              <dl className={styles.schedule}>
                <div className={styles.eventSchedule}>
                  <dt><FanMotionIcon name="calendar" />{c.eventTime}</dt>
                  <dd><time dateTime={live.startsAt}>{formatReservationDateTime(live.startsAt, locale)}</time></dd>
                </div>
                {!viewer.reservation && live.effectiveStatus === "scheduled" ? <div className={styles.deadlineSchedule}>
                  <dt><Clock3 aria-hidden="true" />{locale === "ko" ? "예약 마감" : "Booking closes"}</dt>
                  <dd><time dateTime={live.reservationClosesAt}>{formatReservationDeadline(live.reservationClosesAt, live.startsAt, locale)}</time></dd>
                </div> : null}
              </dl>
              <div className={styles.scheduleMeta}>
                <p className={styles.timeZone}>{c.timeZone}</p>
                <details className={styles.reservationDetails}>
                  <summary>{locale === "ko" ? "예약 전체 기간" : "Full booking period"}</summary>
                  <dl>
                    <div><dt>{locale === "ko" ? "시작" : "Opens"}</dt><dd><time dateTime={live.reservationOpensAt}>{formatReservationDateTime(live.reservationOpensAt, locale)}</time></dd></div>
                    <div><dt>{locale === "ko" ? "마감" : "Closes"}</dt><dd><time dateTime={live.reservationClosesAt}>{formatReservationDateTime(live.reservationClosesAt, locale)}</time></dd></div>
                  </dl>
                </details>
              </div>
            </div>
            {hasPrimaryActionControl ? (
              <div
                className={styles.primaryActionSlot}
                data-live-primary-action-slot
              >
                {primaryControl}
              </div>
            ) : primaryControl}
            {!isIfewLive && (live.missionsAvailable === false ? (
              <FanAction
                variant="neutral"
                className={styles.missionLink}
                fullWidth
                disabled
                helperText={locale === "ko" ? "현재 참여 가능한 미션이 없어요." : "No missions are available right now."}
              >
                {locale === "ko" ? "LIVE 미션 보기" : "View LIVE missions"}
              </FanAction>
            ) : (
              <FanAction
                variant="neutral"
                className={styles.missionLink}
                fullWidth
                href={`/live/${slug}/missions?locale=${locale}` as Route}
                helperText={live.missionsAvailable == null ? (locale === "ko" ? "미션 목록에서 참여 가능 여부를 확인해 주세요." : "Check the mission list for availability.") : undefined}
              >
                <span className={styles.missionLinkContent}><span>{locale === "ko" ? "LIVE 미션 보기" : "View LIVE missions"}</span><ArrowRight aria-hidden="true" /></span>
              </FanAction>
            ))}
            {primaryAction === "watch_live" ? (
              <a className={styles.attendanceShortcut} href="#fan-code">
                <TicketCheck aria-hidden="true" />
                {attendance.kind === "success"
                  ? locale === "ko" ? "출석 기록 보기" : "View attendance record"
                  : isIfewLive ? attendanceCopy.label : locale === "ko" ? "출석 인증하기" : "Verify attendance"}
                <ArrowRight aria-hidden="true" />
              </a>
            ) : null}
            {viewer.reservation && !isIfewClosed && (
              <a
                className={styles.calendarAction}
                href={calendarUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={externalActionLabel(c.calendar, live.title, locale)}
              >
                <span className={styles.calendarActionIcon} data-live-calendar-icon aria-hidden="true">
                  <FanMotionIcon name="calendar" />
                </span>
                <span className={styles.calendarActionLabel}>{c.calendar}</span>
              </a>
            )}
            {!isIfewClosed && live.watch.available &&
              live.watch.url &&
              primaryAction !== "watch_live" && (
                <a
                  className={styles.watchAction}
                  href={watchHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={externalActionLabel(c.watch, live.title, locale)}
                  onClick={rememberWatchReturn}
                >
                  <Play aria-hidden="true" />
                  {c.watch}
                  <ExternalLink aria-hidden="true" />
                </a>
              )}
            {actionError && (
              <p className={styles.actionError} role="alert">
                {actionError}
              </p>
            )}
          </aside>
          <aside className={styles.identity}>
            <CreatorAvatar slug={live.celebrity.slug} src={live.celebrity.image} photos={live.celebrity.photos} position={live.celebrity.imagePosition} size={{ mobile: 48, desktop: 64 }} />
            <div>
              <span>{live.celebrity.name}</span>
              <strong>{formatFanCount(live.celebrity.fanCount)}</strong>
            </div>
            <Link
              href={withLocalePath(`/c/${live.celebrity.slug}`, locale) as Route}
              aria-label={
                locale === "ko"
                  ? `팬페이지 보기: ${live.celebrity.name}`
                  : `View fan page: ${live.celebrity.name}`
              }
            >
              <ArrowRight aria-hidden="true" />
            </Link>
          </aside>
          </div>
          <div className={styles.contentMain}>
            <section className={styles.section}>
              <h2>{c.introduction}</h2>
              <p>{isIfewClosed ? ifewEndedDescription[locale] : live.description}</p>
              <p className={styles.productContext}>{live.productContext}</p>
            </section>
            {!isIfewClosed && <section className={styles.section}>
              <h2>{c.howTo}</h2>
              <ol className={styles.journey} data-step-count={journeySteps.length}>
                {journeySteps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <strong>{step}</strong>
                    <small>{journeyStepHelpers[index]}</small>
                  </li>
                ))}
              </ol>
              {isIfewLive ? <p className={styles.participationNote}>
                {locale === "ko" ? "Fan Passport가 있으면 예약 없이도 출석할 수 있어요. 선물은 응모권으로 별도 신청해 주세요." : "With a Fan Passport, you can check in without a reservation. Use your raffle tickets to enter the prize draw separately."}
              </p> : null}
            </section>}
            {(!isIfewClosed || attendance.kind === "success") && <section
              ref={fanCodeRef}
              id="fan-code"
              className={styles.fanCode}
              tabIndex={-1}
              aria-labelledby={attendance.kind === "success" ? undefined : "fan-code-title"}
              aria-label={attendance.kind === "success" ? attendanceCopy.successTitle : undefined}
            >
              {attendance.kind === "success" ? (
                <div
                  className={styles.attendanceSuccess}
                  role="status"
                  aria-live="polite"
                >
                  <FanActivityCompletionSummary
                    locale={locale}
                    stampType="attendance"
                    title={attendanceCopy.successTitle}
                    description={attendanceCopy.successHelper}
                    scoreDelta={attendance.result.completion.scoreDelta}
                    updatedScore={attendance.result.completion.updatedScore}
                    updatedLevel={levelLabel(
                      locale,
                      attendance.result.completion.updatedLevel,
                    )}
                    leveledUp={attendance.result.completion.leveledUp}
                    passportHref={`/passports/${attendance.result.completion.passportId}?locale=${locale}`}
                    note={attendance.replayed ? attendanceCopy.replay : undefined}
                    primaryAction={
                      <FanAction
                        variant="primary"
                        href={(isIfewLive
                          ? ifewRafflesHref(locale)
                          : isElinaLive
                            ? elinaRafflesHref(locale)
                          : live.missionsAvailable !== false
                            ? `/live/${slug}/survey?locale=${locale}`
                            : `/passports/${attendance.result.completion.passportId}?locale=${locale}`) as Route}
                        trailingIcon={<ArrowRight />}
                      >
                        {isIfewLive
                          ? eventCopy?.prizeAction
                          : isElinaLive
                            ? locale === "ko" ? "선물 고르고 응모하기" : "Choose a prize and enter"
                          : live.missionsAvailable !== false
                            ? attendanceCopy.survey
                            : locale === "ko"
                              ? "Passport에서 참여 기록 보기"
                              : "View participation in Passport"}
                      </FanAction>
                    }
                  />
                </div>
              ) : (
                <div className={styles.fanCodeContent}>
                  <div className={styles.fanCodeIntro}>
                    <div className={styles.fanCodeHeading}>
                      <h2 id="fan-code-title">{eventCopy?.fanCode ?? c.fanCode}</h2>
                      {live.effectiveStatus !== "scheduled" ? <p>{eventCopy?.fanCodeHelper ?? c.fanCodeHelper}</p> : null}
                    </div>
                    <div className={styles.fanCodeIcon} data-fan-code-header-icon aria-hidden="true">
                      <TicketCheck />
                    </div>
                  </div>
                  {live.effectiveStatus === "scheduled" ? (
                    <p className={styles.attendanceNotice} data-before-live>
                      <Clock3 aria-hidden="true" />
                      {attendanceCopy.beforeLive}
                    </p>
                  ) : authenticated && viewer.passport === "missing" ? (
                    <div className={styles.attendanceGate}>
                      <p>{attendanceCopy.passport}</p>
                      <FanAction
                        className={styles.attendanceAction}
                        href={verificationHref}
                        variant="passport"
                        trailingIcon={<ArrowRight />}
                      >
                        {attendanceCopy.issuePassport}
                      </FanAction>
                    </div>
                  ) : (
                    <form
                      className={styles.fanCodeForm}
                      onSubmit={attend}
                      aria-busy={attendance.kind === "pending"}
                      noValidate
                    >
                      <label htmlFor="fan-code-input">
                        {attendanceCopy.label}
                      </label>
                      <div className={styles.fanCodeControl}>
                        <input
                          ref={fanCodeInputRef}
                          id="fan-code-input"
                          name="fan-code"
                          type="text"
                          value={fanCode}
                          onChange={(event) => {
                            setFanCode(
                              event.target.value
                                .replace(/[^a-zA-Z0-9\s]/g, "")
                                .slice(0, 32),
                            );
                            if (attendance.kind === "error") {
                              attendanceKeyRef.current = null;
                              attendanceAttemptsRef.current = 0;
                              setAttendance({ kind: "idle" });
                            }
                          }}
                          inputMode="text"
                          autoComplete="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          minLength={4}
                          maxLength={32}
                          placeholder={attendanceCopy.placeholder}
                          aria-describedby={
                            attendanceError
                              ? "fan-code-help fan-code-error"
                              : "fan-code-help"
                          }
                          aria-invalid={attendanceError ? true : undefined}
                          disabled={
                            attendance.kind === "pending" ||
                            attendance.kind === "rate-limited"
                          }
                        />
                        <button
                          type="submit"
                          disabled={
                            attendance.kind === "pending" ||
                            attendance.kind === "rate-limited" ||
                            fanCode.trim().length < 4
                          }
                        >
                          {!authenticated
                            ? attendanceCopy.signIn
                            : attendance.kind === "pending"
                            ? attendanceCopy.pending
                            : attendanceCopy.submit}
                        </button>
                      </div>
                      <p id="fan-code-help" className={styles.inputHelp}>
                        {attendanceCopy.placeholder}
                      </p>
                      {attendanceError && (
                        <p
                          id="fan-code-error"
                          className={styles.attendanceError}
                          role="alert"
                        >
                          {attendanceError}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              )}
            </section>}
            <section className={styles.section}>
              <h2>{c.benefit}</h2>
              {isIfewLive ? (
                <>
                  <p className={styles.prizeName}>{ifewPrizeName[locale]}</p>
                  <p>{locale === "ko" ? "이퓨 응모권으로 추첨에 응모해 보세요. LIVE 예약이나 시청만으로 자동 응모되지는 않아요." : "Use your ifew raffle tickets to enter the draw. Reserving or watching the LIVE does not enter you automatically."}</p>
                  {attendance.kind !== "success" ? <FanAction
                    href={ifewRafflesHref(locale)} variant="neutral" className={styles.benefitAction} trailingIcon={<ArrowRight />}
                  >{eventCopy?.prizeAction}</FanAction> : null}
                </>
              ) : <><p>{c.benefitIntro}</p><FanAction
                href={`/benefits?locale=${locale}&celebrity=${encodeURIComponent(live.celebrity.slug)}` as Route}
                variant="neutral"
                className={styles.benefitAction}
                trailingIcon={<ArrowRight />}
              >
                {locale === "ko" ? `${live.celebrity.name} 혜택·응모 보기` : `View ${live.celebrity.name} benefits & entries`}
              </FanAction></>}
            </section>
            {authenticated && collectible ? (
              <section className={styles.collectible} aria-labelledby="collectible-title">
                <details open={collectible.eligible || Boolean(collectible.claim) || undefined}>
                  <summary>
                    <h2 id="collectible-title">{locale === "ko" ? "디지털 소장품" : "Digital collectible"}</h2>
                    <span className={styles.collectibleState}>
                      {collectible.claim ? <Check aria-label={locale === "ko" ? "받기 완료" : "Claim complete"} /> : !collectible.eligible ? <LockKeyhole aria-hidden="true" /> : null}
                      {collectible.claim
                        ? locale === "ko" ? "받기 완료" : "Claimed"
                        : collectible.eligible ? locale === "ko" ? "받기 가능" : "Ready to claim"
                        : locale === "ko" ? "참여 완료 후" : "After participation"}
                      <ChevronDown aria-hidden="true" />
                    </span>
                  </summary>
                  <div className={styles.collectibleContent}>
                    <p>{collectible.claim
                      ? collectible.claim.mint.status === "minted"
                        ? locale === "ko" ? `발급 완료 · Token #${collectible.claim.mint.tokenId}` : `Minted · Token #${collectible.claim.mint.tokenId}`
                        : locale === "ko" ? "받기 신청 완료 · 발급을 준비 중이에요." : "Claimed · Your collectible is being issued."
                      : collectible.eligible
                        ? locale === "ko" ? "참여 조건을 완료했어요. LIVE 종료 후 48시간 안에 받아보세요." : "Participation complete. Claim within 48 hours after the LIVE."
                        : locale === "ko" ? "참여 조건을 완료하고 LIVE가 끝나면 받을 수 있어요." : "Available after completing participation and the LIVE ends."}</p>
                    <small>{locale === "ko" ? "받기 마감 · " : "Claim deadline · "}{new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(collectible.claimWindow.until))} KST</small>
                    {!collectible.claim && collectible.eligible ? (
                      <FanAction variant="primary" disabled={collectiblePending} ariaBusy={collectiblePending} onClick={() => void claimCollectible()}>
                        {collectiblePending ? (locale === "ko" ? "받기 처리 중" : "Claiming") : (locale === "ko" ? "소장품 받기" : "Claim collectible")}
                      </FanAction>
                    ) : null}
                    {collectibleError ? <p className={styles.actionError} role="alert">{collectibleError}</p> : null}
                  </div>
                </details>
              </section>
            ) : null}
          </div>

        </div>
      </FanContentContainer>
      {showConfirmation && reservationCompletion && (
        <ReservationDialog
          data={data}
          completion={reservationCompletion}
          locale={locale}
          getAccessToken={getAccessToken}
          onClose={() => setShowConfirmation(false)}
        />
      )}
      </div>
    </FanAppFrame>
  );
}
