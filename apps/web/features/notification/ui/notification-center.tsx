"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { FanAppBottomNavigation, FanAppHeader } from "@/components/fan-shell/fan-app-shell";
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
const ko = {
  title: "알림",
  subtitle: "놓치면 아쉬운 라이브와 팬 혜택 소식을 모았습니다.",
  all: "모두 읽음",
  empty: "아직 도착한 알림이 없습니다.",
  emptyHelp: "라이브를 예약하면 시작 전 알림을 받을 수 있어요.",
  today: "오늘",
  previous: "이전 알림",
  enable: "브라우저 알림 켜기",
  permission: "알림은 예약 완료 뒤, 이 버튼을 선택할 때만 권한을 요청합니다.",
  subscribed: "브라우저 알림이 켜졌습니다.",
  denied: "브라우저 설정에서 알림 권한을 허용해 주세요.",
  unsupported: "이 브라우저는 푸시 알림을 지원하지 않습니다.",
  failed: "알림 설정을 저장하지 못했습니다.",
  signIn: "로그인 후 알림을 확인해 주세요.",
  retry: "다시 시도",
};

function sameDay(value: string) {
  const date = new Date(value),
    now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}
function time(value: string) {
  return new Intl.DateTimeFormat(
    "ko-KR",
    sameDay(value)
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "long", day: "numeric" },
  ).format(new Date(value));
}
export function NotificationCenter() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const params = useSearchParams();
  const locale = params.get("locale") === "en" ? "en" : "ko";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [permission, setPermission] = useState<PushEnableResult | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!ready) return;
    if (!authenticated) {
      setState({ kind: "auth" });
      return;
    }
    try {
      const token = await getAccessToken();
      if (!token) throw new Error();
      const response = await fetch(`/api/notifications?locale=${locale}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const data = notificationCollectionSchema.parse(await response.json());
      setState({
        kind: "ready",
        items: data.notifications,
        unread: data.unreadCount,
      });
    } catch {
      setState({ kind: "error" });
    }
  }, [authenticated, getAccessToken, locale, ready]);
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
      if (response.ok) window.location.assign(item.deepLink);
    })();
  }, [getAccessToken, params, state]);
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
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok)
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
    } finally {
      setBusy(false);
    }
  }
  async function enable() {
    setBusy(true);
    try {
      setPermission(await enablePushNotifications(getAccessToken));
    } finally {
      setBusy(false);
    }
  }
  const status =
    permission === "subscribed"
      ? ko.subscribed
      : permission === "denied"
        ? ko.denied
        : permission === "unsupported"
          ? ko.unsupported
          : permission === "failed"
            ? ko.failed
            : null;
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#notification-content">
        본문으로 바로가기
      </a>
      <FanAppHeader locale={locale} actions={
        <Link className={styles.settingsLink} href={`/settings?locale=${locale}`} aria-label="알림 설정 열기">
          <Settings2 aria-hidden="true" />
        </Link>
      } />

      <main className={styles.content} id="notification-content">
      <header className={styles.pageHeading}>
        <div>
          <h1>{ko.title}</h1>
          <p>{ko.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={readAll}
          disabled={busy || state.kind !== "ready" || state.unread === 0}
        >
          <CheckCheck aria-hidden="true" />
          {ko.all}
        </button>
      </header>
      <section className={styles.permission} aria-labelledby="permission-title">
        <div className={styles.permissionIcon}>
          <Bell aria-hidden="true" />
        </div>
        <div>
          <h2 id="permission-title">{ko.enable}</h2>
          <p>{ko.permission}</p>
          {status && (
            <p className={styles.status} role="status">
              {status}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={enable}
          disabled={busy || permission === "subscribed"}
        >
          {permission === "subscribed" ? "켜짐" : ko.enable}
        </button>
      </section>
      {state.kind === "loading" && (
        <div
          className={`${styles.message} ${styles.loading}`}
          aria-busy="true"
          aria-live="polite"
          role="status"
        >
          <span className={styles.loadingIcon} aria-hidden="true" />
          <p>알림을 불러오는 중입니다.</p>
        </div>
      )}
      {state.kind === "auth" && (
        <div className={styles.message}>
          <Bell aria-hidden="true" />
          <h2>{ko.signIn}</h2>
          <p>로그인하면 읽지 않은 소식과 예약한 LIVE 알림을 이어서 볼 수 있어요.</p>
          <Link className={styles.messageAction} href="/login?returnTo=%2Fnotifications">
            로그인하기
          </Link>
        </div>
      )}
      {state.kind === "error" && (
        <div className={styles.message} role="alert">
          <Bell aria-hidden="true" />
          <h2>알림을 불러오지 못했습니다.</h2>
          <p>연결을 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" onClick={load}>
            {ko.retry}
          </button>
        </div>
      )}
      {state.kind === "ready" && state.items.length === 0 && (
        <div className={styles.empty}>
          <Radio aria-hidden="true" />
          <h2>{ko.empty}</h2>
          <p>{ko.emptyHelp}</p>
          <Link className={styles.messageAction} href={`/live?locale=${locale}` as Route}>
            다가오는 LIVE 보기
          </Link>
        </div>
      )}
      {state.kind === "ready" && state.items.length > 0 && (
        <div className={styles.layout}>
          <div>
            {(["today", "previous"] as const).map((group) =>
              groups[group].length ? (
                <section className={styles.list} key={group}>
                  <h2>{group === "today" ? ko.today : ko.previous}</h2>
                  {groups[group].map((item) => (
                    <Link
                      href={item.deepLink as Route}
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
                          {item.detail} · {time(item.createdAt)}
                        </span>
                      </span>
                      <span className={styles.read} aria-label={item.readAt ? "읽은 알림" : "읽지 않은 알림"}>
                        {item.readAt ? "읽음" : "읽지 않음"}
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
            <h2 id="notification-summary-title">알림 요약</h2>
            <dl>
              <div>
                <dt>읽지 않은 알림</dt>
                <dd>{state.unread}개</dd>
              </div>
              <div>
                <dt>브라우저 알림</dt>
                <dd>{permission === "subscribed" ? "켜짐" : "선택 필요"}</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
      </main>

      <FanAppBottomNavigation locale={locale} />
    </div>
  );
}
