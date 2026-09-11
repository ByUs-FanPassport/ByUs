"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  Bell,
  CheckCheck,
  ChevronRight,
  Radio,
  Settings2,
} from "lucide-react";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { FanAction, fanActionClassName } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { GoogleMark } from "@/components/icons";
import { withLocalePath } from "@/components/locale-path";
import {
  notificationCollectionSchema,
  type NotificationItem,
} from "../domain/notification-model";
import {
  enablePushNotifications,
  type PushEnableResult,
} from "./push-subscription";
import styles from "./notification-center.module.css";

type State =
  | { kind: "loading" }
  | { kind: "auth" }
  | { kind: "error" }
  | { kind: "ready"; items: NotificationItem[]; unread: number };
const copy = {
  ko: {
    title: "알림", subtitle: "놓치면 아쉬운 라이브와 팬 혜택 소식을 모았습니다.", all: "모두 읽음", readingAll: "모두 읽는 중…",
    empty: "아직 도착한 알림이 없습니다.", emptyHelp: "라이브를 예약하면 시작 전 알림을 받을 수 있어요.", today: "오늘", previous: "이전 알림",
    enable: "브라우저 알림 켜기", enabling: "알림 켜는 중…", enabled: "켜짐", permission: "알림은 예약 완료 뒤, 이 버튼을 선택할 때만 권한을 요청합니다.",
    subscribed: "브라우저 알림이 켜졌습니다.", denied: "브라우저 설정에서 알림 권한을 허용해 주세요.", unsupported: "이 브라우저는 푸시 알림을 지원하지 않습니다.", failed: "알림 설정을 저장하지 못했습니다.",
    readAllFailed: "알림을 모두 읽음으로 표시하지 못했습니다. 다시 시도해 주세요.", signIn: "로그인 후 알림을 확인해 주세요.", signInHelp: "로그인하면 읽지 않은 소식과 예약한 LIVE 알림을 이어서 볼 수 있어요.",
    google: "Google로 계속하기", retry: "다시 시도", load: "알림을 불러오는 중입니다.", loadError: "알림을 불러오지 못했습니다.", loadErrorHelp: "연결을 확인한 뒤 다시 시도해 주세요.",
    upcoming: "다가오는 LIVE 보기", settings: "알림 설정 열기", read: "읽음", unread: "읽지 않음", readLabel: "읽은 알림", unreadLabel: "읽지 않은 알림",
    summary: "알림 요약", unreadSummary: "읽지 않은 알림", notifications: "개", browser: "브라우저 알림", choose: "선택 필요",
  },
  en: {
    title: "Notifications", subtitle: "LIVE reminders and fan benefit updates, all in one place.", all: "Mark all as read", readingAll: "Marking all as read…",
    empty: "No notifications yet.", emptyHelp: "Reserve a spot for a LIVE to get a reminder before it starts.", today: "Today", previous: "Earlier notifications",
    enable: "Enable browser notifications", enabling: "Enabling notifications…", enabled: "On", permission: "We only request permission after a reservation, when you select this button.",
    subscribed: "Browser notifications are on.", denied: "Allow notifications in your browser settings.", unsupported: "This browser does not support push notifications.", failed: "We couldn't save your notification settings.",
    readAllFailed: "We couldn't mark all notifications as read. Please try again.", signIn: "Sign in to view notifications.", signInHelp: "Sign in to continue viewing unread updates and reminders for your reserved LIVE events.",
    google: "Continue with Google", retry: "Try again", load: "Loading notifications.", loadError: "We couldn't load notifications.", loadErrorHelp: "Check your connection and try again.",
    upcoming: "View upcoming LIVE", settings: "Open notification settings", read: "Read", unread: "Unread", readLabel: "Read notification", unreadLabel: "Unread notification",
    summary: "Notification summary", unreadSummary: "Unread notifications", notifications: "", browser: "Browser notifications", choose: "Action needed",
  },
} as const;

function sameDay(value: string) {
  const date = new Date(value),
    now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}
function time(value: string, locale: "ko" | "en") {
  return new Intl.DateTimeFormat(
    locale === "ko" ? "ko-KR" : "en-US",
    sameDay(value)
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "long", day: "numeric" },
  ).format(new Date(value));
}
export function NotificationCenter() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const ownerId = user?.id ?? null;
  const params = useSearchParams();
  const locale = params.get("locale") === "en" ? "en" : "ko";
  const c = copy[locale];
  const [state, setState] = useState<State>({ kind: "loading" });
  const [permission, setPermission] = useState<PushEnableResult | null>(null);
  const [pendingAction, setPendingAction] = useState<"read-all" | "enable" | null>(null);
  const [actionError, setActionError] = useState("");
  const activeRef = useRef(true);
  const ownerRef = useRef(ownerId);
  const loadGenerationRef = useRef(0);
  const actionPendingRef = useRef(false);
  const actionGenerationRef = useRef(0);
  useLayoutEffect(() => {
    const ownerChanged = ownerRef.current !== ownerId;
    activeRef.current = true;
    ownerRef.current = ownerId;
    loadGenerationRef.current += 1;
    actionGenerationRef.current += 1;
    actionPendingRef.current = false;
    setPendingAction(null);
    setActionError("");
    if (ownerChanged) {
      setState({ kind: "loading" });
      setPermission(null);
    }
    return () => {
      activeRef.current = false;
      loadGenerationRef.current += 1;
      actionGenerationRef.current += 1;
      actionPendingRef.current = false;
    };
  }, [ownerId]);
  const load = useCallback(async () => {
    if (!ready) return;
    if (!authenticated) {
      setState({ kind: "auth" });
      return;
    }
    const ownerAtStart = ownerId;
    const generation = ++loadGenerationRef.current;
    try {
      const token = await getAccessToken();
      if (!activeRef.current || ownerRef.current !== ownerAtStart || generation !== loadGenerationRef.current) return;
      if (!token) throw new Error();
      const response = await fetch(`/api/notifications?locale=${locale}&recipientLinks=1`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const data = notificationCollectionSchema.parse(await response.json());
      if (!activeRef.current || ownerRef.current !== ownerAtStart || generation !== loadGenerationRef.current) return;
      setState({
        kind: "ready",
        items: data.notifications,
        unread: data.unreadCount,
      });
    } catch {
      if (activeRef.current && ownerRef.current === ownerAtStart && generation === loadGenerationRef.current)
        setState({ kind: "error" });
    }
  }, [authenticated, getAccessToken, locale, ownerId, ready]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = params.get("open");
    if (!id || state.kind !== "ready") return;
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) window.location.assign(withLocalePath(item.deepLink, locale));
    })();
  }, [getAccessToken, locale, params, state]);
  const groups = useMemo(
    () =>
      state.kind === "ready"
        ? {
            today: state.items.filter((item) => sameDay(item.createdAt)),
            previous: state.items.filter((item) => !sameDay(item.createdAt)),
          }
        : { today: [], previous: [] },
    [state],
  );
  async function read(item: NotificationItem) {
    const token = await getAccessToken();
    if (!token) return;
    const response = await fetch(`/api/notifications/${item.id}/read`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok)
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              items: current.items.map((value) =>
                value.id === item.id
                  ? {
                      ...value,
                      readAt: value.readAt ?? new Date().toISOString(),
                    }
                  : value,
              ),
              unread: Math.max(0, current.unread - (item.readAt ? 0 : 1)),
            }
          : current,
      );
  }
  async function readAll() {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    const ownerAtStart = ownerId;
    const generation = ++actionGenerationRef.current;
    setPendingAction("read-all");
    setActionError("");
    try {
      const token = await getAccessToken();
      if (!activeRef.current || ownerRef.current !== ownerAtStart || generation !== actionGenerationRef.current) return;
      if (!token) throw new Error("token");
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("response");
      if (!activeRef.current || ownerRef.current !== ownerAtStart || generation !== actionGenerationRef.current) return;
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              items: current.items.map((item) => ({
                ...item,
                readAt: item.readAt ?? new Date().toISOString(),
              })),
              unread: 0,
            }
          : current,
      );
    } catch {
      if (activeRef.current && ownerRef.current === ownerAtStart && generation === actionGenerationRef.current)
        setActionError(c.readAllFailed);
    } finally {
      if (activeRef.current && ownerRef.current === ownerAtStart && generation === actionGenerationRef.current) {
        actionPendingRef.current = false;
        setPendingAction(null);
      }
    }
  }
  async function enable() {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    const ownerAtStart = ownerId;
    const generation = ++actionGenerationRef.current;
    setPendingAction("enable");
    setActionError("");
    const isCurrent = () => activeRef.current
      && ownerRef.current === ownerAtStart
      && generation === actionGenerationRef.current;
    try {
      const guardedGetAccessToken = async () => {
        if (!isCurrent()) return null;
        const token = await getAccessToken();
        return isCurrent() ? token : null;
      };
      const result = await enablePushNotifications(guardedGetAccessToken);
      if (!isCurrent()) return;
      setPermission(result);
    } catch {
      if (isCurrent())
        setPermission("failed");
    } finally {
      if (isCurrent()) {
        actionPendingRef.current = false;
        setPendingAction(null);
      }
    }
  }
  const status =
    permission === "subscribed"
      ? c.subscribed
      : permission === "denied"
        ? c.denied
        : permission === "unsupported"
          ? c.unsupported
          : permission === "failed"
            ? c.failed
            : null;
  return (
    <FanAppFrame locale={locale} mainId="notification-content" actions={
        <Link className={styles.settingsLink} href={`/settings?locale=${locale}`} aria-label={c.settings}>
          <Settings2 aria-hidden="true" />
        </Link>
      }>
      <div className={styles.page}>
      <FanContentContainer as="main" className={styles.content} id="notification-content" tabIndex={-1}>
      <header className={styles.pageHeading}>
        <div>
          <h1>{c.title}</h1>
          <p>{c.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={readAll}
          disabled={pendingAction !== null || state.kind !== "ready" || state.unread === 0}
          aria-busy={pendingAction === "read-all"}
        >
          <CheckCheck aria-hidden="true" />
          {pendingAction === "read-all" ? c.readingAll : c.all}
        </button>
      </header>
      {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
      <section className={styles.permission} aria-labelledby="permission-title">
        <div className={styles.permissionIcon}>
          <Bell aria-hidden="true" />
        </div>
        <div>
          <h2 id="permission-title">{c.enable}</h2>
          <p>{c.permission}</p>
          {status && (
            <p className={styles.status} role={permission === "failed" ? "alert" : "status"}>
              {status}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={enable}
          disabled={pendingAction !== null || permission === "subscribed"}
          aria-busy={pendingAction === "enable"}
        >
          {pendingAction === "enable" ? c.enabling : permission === "subscribed" ? c.enabled : c.enable}
        </button>
      </section>
      {state.kind === "loading" && (
        <FanState kind="loading" title={c.load} />
      )}
      {state.kind === "auth" && (
        <FanState
          kind="auth"
          icon={<Bell aria-hidden="true" />}
          title={c.signIn}
          description={c.signInHelp}
          actions={<FanAction variant="service" fullWidth href={`/login?returnTo=%2Fnotifications%3Flocale%3D${locale}&locale=${locale}`}><GoogleMark /><span>{c.google}</span></FanAction>}
        />
      )}
      {state.kind === "error" && (
        <FanState
          kind="error"
          icon={<Bell aria-hidden="true" />}
          title={c.loadError}
          description={c.loadErrorHelp}
          actions={<FanAction variant="neutral" fullWidth onClick={load}>{c.retry}</FanAction>}
        />
      )}
      {state.kind === "ready" && state.items.length === 0 && (
        <FanState
          kind="empty"
          icon={<Radio aria-hidden="true" />}
          title={c.empty}
          description={c.emptyHelp}
          actions={<Link className={fanActionClassName("neutral", { fullWidth: true })} href={`/live?locale=${locale}` as Route}>{c.upcoming}</Link>}
        />
      )}
      {state.kind === "ready" && state.items.length > 0 && (
        <div className={styles.layout}>
          <div>
            {(["today", "previous"] as const).map((group) =>
              groups[group].length ? (
                <section className={styles.list} key={group}>
                  <h2>{group === "today" ? c.today : c.previous}</h2>
                  {groups[group].map((item) => (
                    <Link
                      href={withLocalePath(item.deepLink, locale) as Route}
                      key={item.id}
                      className={styles.row}
                      data-unread={!item.readAt}
                      data-read-state={item.readAt ? "read" : "unread"}
                      onClick={() => void read(item)}
                    >
                      <span className={styles.dot} aria-hidden="true" />
                      <span className={styles.copy}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.detail} · {time(item.createdAt, locale)}
                        </span>
                      </span>
                      <span className={styles.read} aria-label={item.readAt ? c.readLabel : c.unreadLabel}>
                        {item.readAt ? c.read : c.unread}
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  ))}
                </section>
              ) : null,
            )}
          </div>
          <aside className={styles.summary} aria-labelledby="notification-summary-title">
            <Bell aria-hidden="true" />
            <h2 id="notification-summary-title">{c.summary}</h2>
            <dl>
              <div>
                <dt>{c.unreadSummary}</dt>
                <dd>{state.unread}{c.notifications}</dd>
              </div>
              <div>
                <dt>{c.browser}</dt>
                <dd>{permission === "subscribed" ? c.enabled : c.choose}</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
      </FanContentContainer>
      </div>
    </FanAppFrame>
  );
}
