"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
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
  createLiveAttendanceResponseSchema,
  isNormalizedFanCodeValid,
  normalizeFanCode,
  type CreateLiveAttendanceResponse,
} from "@/features/live/domain/live-attendance";
import { createLiveReservationResponseSchema } from "@/features/live/domain/live-reservation";
import {
  enablePushNotifications,
  type PushEnableResult,
} from "@/features/notification/ui/push-subscription";
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
    youtube: "YouTube Live",
    introduction: "LIVE 소개",
    howTo: "참여 방법",
    benefit: "LIVE 혜택",
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
      issuePassport: "Fan Passport 발급하기",
      beforeLive: "Fan Code는 LIVE 시작 후 입력할 수 있어요.",
      invalid:
        "Fan Code가 올바르지 않아요. LIVE에서 공개된 코드를 다시 확인해 주세요.",
      format: "영문과 숫자로 4자 이상 입력해 주세요.",
      rateLimited: "입력 횟수를 초과했어요. {time} 후 다시 시도해 주세요.",
      unavailable:
        "지금은 출석을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
      wallet: "Passport 준비가 끝나지 않았어요. 잠시 후 다시 시도해 주세요.",
      successTitle: "LIVE 출석을 남겼어요",
      successHelper: "Attendance Stamp와 Fan Score +3이 기록되었습니다.",
      replay: "이미 완료한 출석 기록을 안전하게 확인했어요.",
      survey: "설문 참여하고 다음 Stamp 받기",
    },
    steps: ["예약", "YouTube 시청", "Fan Code", "설문", "Stamp"],
    stepHelpers: [
      "일정을 먼저 저장해요",
      "새 탭에서 시청해요",
      "LIVE 시작 후 입력해요",
      "출석 완료 후 참여해요",
      "참여 기록을 남겨요",
    ],
    action: {
      reservation_upcoming: "예약 오픈 전",
      sign_in_to_reserve: "로그인하고 예약하기",
      verify_fan: "팬 인증하고 예약하기",
      reserve: "라이브 예약하기",
      reserved: "예약 완료",
      watch_live: "YouTube LIVE 입장",
      reservation_closed: "예약 마감",
      live_ended: "종료된 LIVE",
      live_cancelled: "취소된 LIVE",
    },
    reservationPeriod: "예약 기간",
    eventTime: "LIVE 일정",
    reservePending: "예약 처리 중",
    reserveError:
      "예약을 완료하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.",
    loadError: "LIVE 정보를 불러오지 못했어요.",
    loadErrorHelper: "잠시 후 다시 시도하거나 라이브 목록으로 돌아가 주세요.",
    notFound: "공개된 LIVE를 찾을 수 없어요.",
    retry: "다시 불러오기",
    calendar: "Google Calendar에 추가",
    watch: "YouTube LIVE 입장",
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
    youtube: "YouTube Live",
    introduction: "About this LIVE",
    howTo: "How to join",
    benefit: "LIVE benefit",
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
      issuePassport: "Create Fan Passport",
      beforeLive: "You can enter the Fan Code once the LIVE starts.",
      invalid:
        "That Fan Code isn’t valid. Check the code shared during the LIVE.",
      format: "Enter at least 4 letters or numbers.",
      rateLimited: "Too many attempts. Try again in {time}.",
      unavailable: "Attendance can’t be verified right now. Try again shortly.",
      wallet: "Your Passport is still getting ready. Try again shortly.",
      successTitle: "Your LIVE attendance is recorded",
      successHelper: "You earned an Attendance Stamp and +3 Fan Score.",
      replay: "Your completed attendance record was safely retrieved.",
      survey: "Take the survey for your next Stamp",
    },
    steps: ["Reserve", "Watch on YouTube", "Fan Code", "Survey", "Stamp"],
    stepHelpers: [
      "Save the schedule",
      "Watch in a new tab",
      "Enter after LIVE starts",
      "Available after attendance",
      "Keep your participation record",
    ],
    action: {
      reservation_upcoming: "Reservations open soon",
      sign_in_to_reserve: "Sign in to reserve",
      verify_fan: "Verify fan status to reserve",
      reserve: "Reserve this LIVE",
      reserved: "Reserved",
      watch_live: "Watch on YouTube",
      reservation_closed: "Reservations closed",
      live_ended: "LIVE ended",
      live_cancelled: "LIVE cancelled",
    },
    reservationPeriod: "Reservation period",
    eventTime: "LIVE schedule",
    reservePending: "Reserving",
    reserveError:
      "We couldn’t complete your reservation. Check the status and try again.",
    loadError: "We couldn’t load this LIVE.",
    loadErrorHelper: "Try again shortly or return to the live list.",
    notFound: "This public LIVE could not be found.",
    retry: "Try again",
    calendar: "Add to Google Calendar",
    watch: "Watch on YouTube",
    reservedTitle: "Your reservation is complete",
    reservedHelper: "Save the date and come back when the LIVE begins.",
    stampIssued: "Reservation Stamp earned",
    continue: "Keep browsing",
    close: "Close reservation confirmation",
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
    timeZoneName: "short",
  }).format(new Date(iso));
}

function formatRange(start: string, end: string, locale: Locale) {
  return `${formatDateTime(start, locale)} — ${formatDateTime(end, locale)}`;
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

function navigationHref(index: number, slug: string, locale: Locale): Route {
  if (index === 0) return "/";
  if (index === 1) return "/celebrities";
  if (index === 2) return `/live/${slug}?locale=${locale}` as Route;
  if (index === 3) return "/passports" as Route;
  return "/benefits" as Route;
}

function LiveHeader({ locale, slug }: { locale: Locale; slug: string }) {
  const c = copy[locale];
  const otherLocale = locale === "ko" ? "en" : "ko";
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.wordmark} href="/" aria-label="ByUs home">
          <Image
            src="/images/guest-home/byus-wordmark.svg"
            alt="ByUs"
            width={80}
            height={30}
            priority
          />
        </Link>
        <nav
          className={styles.desktopNav}
          aria-label={locale === "ko" ? "주요 메뉴" : "Primary navigation"}
        >
          {c.nav.map((label, index) => (
            <Link
              key={label}
              className={index === 2 ? styles.activeNav : undefined}
              href={navigationHref(index, slug, locale)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link
          className={styles.locale}
          href={`/live/${slug}?locale=${otherLocale}` as Route}
          lang={otherLocale}
          hrefLang={otherLocale}
        >
          {locale === "ko" ? "KO / EN" : "EN / KO"}
        </Link>
      </div>
    </header>
  );
}

function ReservationDialog({
  data,
  locale,
  onClose,
  getAccessToken,
}: {
  data: LiveEventResponse;
  locale: Locale;
  onClose: () => void;
  getAccessToken: () => Promise<string | null>;
}) {
  const c = copy[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pushState, setPushState] = useState<PushEnableResult | null>(null);
  const [pushPending, setPushPending] = useState(false);

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
      aria-describedby="reservation-helper"
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
      <div className={styles.dialogStatus} aria-hidden="true">
        <Check />
      </div>
      <h2 id="reservation-title">{c.reservedTitle}</h2>
      <p id="reservation-helper">{c.reservedHelper}</p>
      <div className={styles.dialogEvent}>
        <strong>{data.live.title}</strong>
        <span>
          <CalendarDays aria-hidden="true" />
          {formatDateTime(data.live.startsAt, locale)}
        </span>
      </div>
      <Image
        className={styles.stampArtwork}
        src="/images/stamps/kara-reservation-stamp.png"
        alt={
          locale === "ko"
            ? `${data.live.celebrity.name} 예약 Stamp`
            : `${data.live.celebrity.name} Reservation Stamp`
        }
        width={360}
        height={360}
      />
      <p className={styles.stampState}>
        <Stamp aria-hidden="true" />
        {c.stampIssued}
      </p>
      <a
        className={styles.dialogSecondary}
        href={googleCalendarUrl(data.live)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <CalendarDays aria-hidden="true" />
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
                ? "알림 설정을 저장하지 못했습니다."
                : "Could not save notification settings."}
        </p>
      )}
      <button
        className={styles.dialogPrimary}
        type="button"
        onClick={() => dialogRef.current?.close()}
      >
        {c.continue}
      </button>
    </dialog>
  );
}

export function LiveEventScreen({
  slug,
  locale,
}: {
  slug: string;
  locale: Locale;
}) {
  const c = copy[locale];
  const { ready: authReady, authenticated, getAccessToken } = usePrivy();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reservePending, setReservePending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [fanCode, setFanCode] = useState("");
  const [attendance, setAttendance] = useState<AttendanceState>({
    kind: "idle",
  });
  const [retrySeconds, setRetrySeconds] = useState(0);
  const fanCodeRef = useRef<HTMLElement>(null);
  const fanCodeInputRef = useRef<HTMLInputElement>(null);
  const attendanceKeyRef = useRef<string | null>(null);
  const attendanceAttemptsRef = useRef(0);

  const load = useCallback(async () => {
    if (!authReady) return;
    setView({ kind: "loading" });
    try {
      const token = authenticated ? await getAccessToken() : null;
      const response = await fetch(
        `/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`,
        {
          method: "GET",
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        },
      );
      if (!response.ok) {
        setView({ kind: "error", notFound: response.status === 404 });
        return;
      }
      setView({
        kind: "ready",
        data: liveEventResponseSchema.parse(await response.json()),
      });
    } catch {
      setView({ kind: "error", notFound: false });
    }
  }, [authReady, authenticated, getAccessToken, locale, slug]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function reserve() {
    if (view.kind !== "ready" || reservePending) return;
    setReservePending(true);
    setActionError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const storageKey = `byus:live-reservation:${view.data.live.id}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = window.crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const response = await fetch(
        `/api/live-events/${encodeURIComponent(view.data.live.id)}/reservation`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
      if (!response.ok) {
        const current = await fetch(
          `/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        if (current.ok)
          setView({
            kind: "ready",
            data: liveEventResponseSchema.parse(await current.json()),
          });
        throw new Error("reservation failed");
      }
      createLiveReservationResponseSchema.parse(await response.json());
      const refreshed = await fetch(
        `/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!refreshed.ok) throw new Error("refresh failed");
      const data = liveEventResponseSchema.parse(await refreshed.json());
      if (!data.viewer.reservation)
        throw new Error("reservation not projected");
      window.sessionStorage.removeItem(storageKey);
      setView({ kind: "ready", data });
      setShowConfirmation(true);
    } catch {
      setActionError(c.reserveError);
    } finally {
      setReservePending(false);
    }
  }

  function rememberWatchReturn() {
    const query = searchParams.toString();
    window.sessionStorage.setItem(
      "byus:live-return",
      JSON.stringify({
        route: `${pathname}${query ? `?${query}` : ""}#fan-code`,
        scrollY: window.scrollY,
        liveId: view.kind === "ready" ? view.data.live.id : null,
      }),
    );
  }

  async function attend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      view.kind !== "ready" ||
      attendance.kind === "pending" ||
      attendance.kind === "rate-limited"
    )
      return;
    const normalizedCode = normalizeFanCode(fanCode);
    if (!isNormalizedFanCodeValid(normalizedCode)) {
      setFanCode("");
      setAttendance({ kind: "error", code: "FORMAT" });
      window.requestAnimationFrame(() => fanCodeInputRef.current?.focus());
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
  }

  if (view.kind === "loading") {
    return (
      <div className={styles.page}>
        <LiveHeader locale={locale} slug={slug} />
        <main
          className={styles.loading}
          aria-busy="true"
          aria-label={locale === "ko" ? "LIVE 불러오는 중" : "Loading LIVE"}
        >
          <div />
          <div />
        </main>
      </div>
    );
  }
  if (view.kind === "error") {
    return (
      <div className={styles.page}>
        <LiveHeader locale={locale} slug={slug} />
        <main className={styles.error} role="alert">
          <Radio aria-hidden="true" />
          <h1>{view.notFound ? c.notFound : c.loadError}</h1>
          <p>{c.loadErrorHelper}</p>
          {!view.notFound && (
            <button type="button" onClick={() => void load()}>
              {c.retry}
            </button>
          )}
          <Link href="/">{c.nav[0]}</Link>
        </main>
      </div>
    );
  }

  const data = view.data;
  const { live, viewer, primaryAction } = data;
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
  const returnTo = `/live/${slug}?locale=${locale}`;
  const primaryClass =
    primaryAction === "reserve" ? styles.spectrumAction : styles.primaryAction;
  const bottomNavItems = Array.from(c.nav).slice(0, 4);
  const attendanceError =
    attendance.kind === "error"
      ? attendance.code === "ATTENDANCE_CODE_INVALID"
        ? c.attendance.invalid
        : attendance.code === "FORMAT"
          ? c.attendance.format
          : attendance.code === "WALLET_NOT_READY"
            ? c.attendance.wallet
            : attendance.code === "PASSPORT_REQUIRED"
              ? c.attendance.passport
              : c.attendance.unavailable
      : attendance.kind === "rate-limited"
        ? c.attendance.rateLimited.replace("{time}", formatRetry(retrySeconds))
        : null;

  const primaryControl =
    primaryAction === "sign_in_to_reserve" ? (
      <Link
        className={primaryClass}
        href={
          `/login?returnTo=${encodeURIComponent(returnTo)}&intent=reserve` as Route
        }
      >
        <TicketCheck aria-hidden="true" />
        {actionLabel}
        <ArrowRight aria-hidden="true" />
      </Link>
    ) : primaryAction === "verify_fan" ? (
      <Link
        className={primaryClass}
        href={`/c/${live.celebrity.slug}/verify` as Route}
      >
        <TicketCheck aria-hidden="true" />
        {actionLabel}
        <ArrowRight aria-hidden="true" />
      </Link>
    ) : primaryAction === "watch_live" &&
      live.watch.available &&
      live.watch.url ? (
      <a
        className={primaryClass}
        href={live.watch.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={rememberWatchReturn}
      >
        <Play aria-hidden="true" />
        {actionLabel}
        <ExternalLink aria-hidden="true" />
      </a>
    ) : primaryAction === "reserve" ? (
      <button
        className={primaryClass}
        type="button"
        disabled={reservePending}
        onClick={() => void reserve()}
      >
        <TicketCheck aria-hidden="true" />
        {actionLabel}
        <ArrowRight aria-hidden="true" />
      </button>
    ) : (
      <button className={primaryClass} type="button" disabled>
        <LockKeyhole aria-hidden="true" />
        {actionLabel}
      </button>
    );

  return (
    <div className={styles.page}>
      <LiveHeader locale={locale} slug={slug} />
      <main className={styles.main}>
        <Link className={styles.back} href="/">
          <ArrowLeft aria-hidden="true" />
          {c.back}
        </Link>
        <div className={styles.heroGrid}>
          <div className={styles.heroMedia}>
            <Image
              src={live.heroImage.url}
              alt={live.heroImage.alt}
              fill
              sizes="(min-width: 1024px) 66vw, 100vw"
              priority
            />
          </div>
          <aside
            className={styles.actionRail}
            aria-label={
              locale === "ko" ? "LIVE 예약 정보" : "LIVE reservation details"
            }
          >
            <span className={styles.status} data-status={live.effectiveStatus}>
              {statusLabel}
            </span>
            <div>
              <p className={styles.brand}>{live.brand.name}</p>
              <h1>{live.title}</h1>
            </div>
            <dl className={styles.schedule}>
              <div>
                <dt>
                  <CalendarDays aria-hidden="true" />
                  {c.eventTime}
                </dt>
                <dd>{formatDateTime(live.startsAt, locale)}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 aria-hidden="true" />
                  {c.reservationPeriod}
                </dt>
                <dd>
                  {formatRange(
                    live.reservationOpensAt,
                    live.reservationClosesAt,
                    locale,
                  )}
                </dd>
              </div>
            </dl>
            {primaryControl}
            {viewer.reservation && (
              <a
                className={styles.calendarAction}
                href={calendarUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <CalendarDays aria-hidden="true" />
                {c.calendar}
              </a>
            )}
            {live.watch.available &&
              live.watch.url &&
              primaryAction !== "watch_live" && (
                <a
                  className={styles.watchAction}
                  href={live.watch.url}
                  target="_blank"
                  rel="noopener noreferrer"
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
        </div>

        <div className={styles.contentGrid}>
          <div className={styles.contentMain}>
            <section className={styles.section}>
              <h2>{c.introduction}</h2>
              <p>{live.description}</p>
              <p className={styles.productContext}>{live.productContext}</p>
            </section>
            <section className={styles.section}>
              <h2>{c.howTo}</h2>
              <ol className={styles.journey}>
                {c.steps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <strong>{step}</strong>
                    <small>{c.stepHelpers[index]}</small>
                  </li>
                ))}
              </ol>
            </section>
            <section
              ref={fanCodeRef}
              id="fan-code"
              className={styles.fanCode}
              tabIndex={-1}
              aria-labelledby="fan-code-title"
            >
              {attendance.kind === "success" ? (
                <div
                  className={styles.attendanceSuccess}
                  role="status"
                  aria-live="polite"
                >
                  <div
                    className={styles.attendanceStampWrap}
                    aria-hidden="true"
                  >
                    <Image
                      className={styles.attendanceStamp}
                      src="/images/stamps/kara-attendance-stamp.png"
                      alt=""
                      width={320}
                      height={320}
                    />
                    <span>+3</span>
                  </div>
                  <div className={styles.attendanceSuccessCopy}>
                    <p className={styles.attendanceEyebrow}>Attendance Stamp</p>
                    <h2 id="fan-code-title">{c.attendance.successTitle}</h2>
                    <p>{c.attendance.successHelper}</p>
                    {attendance.replayed && (
                      <p className={styles.replayNote}>{c.attendance.replay}</p>
                    )}
                    <Link
                      className={styles.surveyAction}
                      href={`/live/${slug}/survey?locale=${locale}` as Route}
                    >
                      {c.attendance.survey}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className={styles.fanCodeContent}>
                  <div className={styles.fanCodeIntro}>
                    <div className={styles.fanCodeIcon} aria-hidden="true">
                      <TicketCheck />
                    </div>
                    <div>
                      <h2 id="fan-code-title">{c.fanCode}</h2>
                      <p>{c.fanCodeHelper}</p>
                    </div>
                  </div>
                  {!authenticated ? (
                    <Link
                      className={styles.attendanceAction}
                      href={
                        `/login?returnTo=${encodeURIComponent(`${returnTo}#fan-code`)}&intent=attendance` as Route
                      }
                    >
                      {c.attendance.signIn}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ) : viewer.passport === "missing" ? (
                    <div className={styles.attendanceGate}>
                      <p>{c.attendance.passport}</p>
                      <Link
                        className={styles.attendanceAction}
                        href={`/c/${live.celebrity.slug}/verify` as Route}
                      >
                        {c.attendance.issuePassport}
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </div>
                  ) : live.effectiveStatus === "scheduled" ? (
                    <p className={styles.attendanceNotice}>
                      <Clock3 aria-hidden="true" />
                      {c.attendance.beforeLive}
                    </p>
                  ) : (
                    <form
                      className={styles.fanCodeForm}
                      onSubmit={attend}
                      aria-busy={attendance.kind === "pending"}
                      noValidate
                    >
                      <label htmlFor="fan-code-input">
                        {c.attendance.label}
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
                          placeholder={c.attendance.placeholder}
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
                          {attendance.kind === "pending"
                            ? c.attendance.pending
                            : c.attendance.submit}
                        </button>
                      </div>
                      <p id="fan-code-help" className={styles.inputHelp}>
                        {c.attendance.placeholder}
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
            </section>
            <section className={styles.section}>
              <h2>{c.benefit}</h2>
              <p>{live.productContext}</p>
            </section>
          </div>
          <aside className={styles.identity}>
            <Image src={live.celebrity.image} alt="" width={64} height={64} />
            <div>
              <span>{live.celebrity.name}</span>
              <strong>{live.brand.name}</strong>
            </div>
            <Link
              href={`/c/${live.celebrity.slug}` as Route}
              aria-label={`${live.celebrity.name} fan page`}
            >
              <ArrowRight aria-hidden="true" />
            </Link>
          </aside>
        </div>
      </main>
      {showConfirmation && (
        <ReservationDialog
          data={data}
          locale={locale}
          getAccessToken={getAccessToken}
          onClose={() => setShowConfirmation(false)}
        />
      )}
      <nav
        className={styles.bottomNav}
        aria-label={locale === "ko" ? "하단 메뉴" : "Bottom navigation"}
      >
        {bottomNavItems.map((label, index) => (
          <Link
            key={label}
            className={index === 2 ? styles.bottomActive : undefined}
            href={navigationHref(index, slug, locale)}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
