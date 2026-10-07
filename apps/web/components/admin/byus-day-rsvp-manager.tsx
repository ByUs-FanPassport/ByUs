"use client";

import { usePrivy } from "@privy-io/react-auth";
import { RefreshCw, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { rsvpAttendeesSchema, type RsvpAttendee } from "@/features/connect/rsvp-admin";
import { AdminAccessState } from "./admin-access-state";
import { AdminListSearch, AdminPagination, useAdminPagination } from "./admin-pagination";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import shared from "./operations.module.css";
import styles from "./byus-day-rsvp-manager.module.css";

const copy = {
  ko: {
    description: "ByUs Day에 접수한 참가자 명단을 확인하세요.", total: "누적 접수", unit: "명",
    attendees: "참가자 명단", order: "최신 접수순", refresh: "새로고침", searchHelp: "이름, 소속, 직책, 이메일, 전화번호로 검색할 수 있어요.",
    name: "접수자", affiliation: "소속", occupation: "직책", contact: "연락처", nationality: "국적", date: "접수일 (KST)",
    loading: "접수 명단을 불러오는 중입니다.", error: "접수 명단을 불러오지 못했습니다.", retry: "다시 시도",
    empty: "아직 접수된 참가자가 없습니다.", noResults: "검색 결과가 없습니다.", clear: "검색 초기화",
    scroll: "표를 좌우로 움직여 전체 정보를 확인하세요.",
  },
  en: {
    description: "View the people registered for ByUs Day.", total: "Total registrations", unit: "",
    attendees: "Attendee list", order: "Newest first", refresh: "Refresh", searchHelp: "Search by name, organization, role, email or phone number.",
    name: "Attendee", affiliation: "Organization", occupation: "Role", contact: "Contact", nationality: "Nationality", date: "Registered (KST)",
    loading: "Loading registrations.", error: "Registrations could not be loaded.", retry: "Try again",
    empty: "No one has registered yet.", noResults: "No registrations match your search.", clear: "Clear search",
    scroll: "Scroll horizontally to see all attendee details.",
  },
} as const;

type ListState = { status: "ready"; attendees: RsvpAttendee[] }
  | { status: "loading" | "error" | "unauthenticated" | "denied" };

export function ByusDayRsvpManager({ locale }: { locale: AdminLocale }) {
  const session = useAdminSession();
  const { user, getAccessToken } = usePrivy();
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  return <Attendees key={`${user?.id}:${session.admin.email}:${session.admin.role}`} locale={locale}
    adminRole={session.admin.role} getAccessToken={getAccessToken} />;
}

function Attendees({ locale, adminRole, getAccessToken }: {
  locale: AdminLocale; adminRole: string; getAccessToken: () => Promise<string | null>;
}) {
  const t = copy[locale];
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  // ponytail: one event roster; move search and pagination into the RPC if registrations reach thousands.
  const attendees = state.status === "ready" ? state.attendees : [];
  const needle = query.trim().toLocaleLowerCase(locale);
  const filtered = attendees.filter(item => [item.koreanName, item.englishName, item.affiliation, item.occupation, item.email, item.phone]
    .some(value => value.toLocaleLowerCase(locale).includes(needle)));
  const pagination = useAdminPagination(filtered, needle);
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  const date = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (controller.signal.aborted) return;
        if (!token) { setState({ status: "unauthenticated" }); return; }
        const response = await fetch("/api/admin/byus-day-rsvps", {
          headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setState({ status: response.status === 401 ? "unauthenticated" : "denied" }); return;
        }
        if (!response.ok) throw new Error("RSVP_ADMIN_UNAVAILABLE");
        const result = rsvpAttendeesSchema.parse(await response.json());
        if (!controller.signal.aborted) setState({ status: "ready", attendees: result.attendees });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [getAccessToken, revision]);

  if (state.status === "unauthenticated" || state.status === "denied") return <AdminAccessState status={state.status} locale={locale} />;
  const refresh = () => setRevision(value => value + 1);
  return <AdminOperationsShell locale={locale} adminRole={adminRole}>
    <header className={styles.heading}>
      <div><h1>ByUs Day RSVP</h1><p>{t.description}</p></div>
      <div className={styles.total} aria-live="polite"><span>{t.total}</span><strong>{state.status === "ready" ? attendees.length.toLocaleString(locale) : "—"}<small>{t.unit}</small></strong></div>
    </header>
    <section className={styles.panel} aria-labelledby="rsvp-attendees-heading">
      <div className={styles.panelHeading}>
        <div><h2 id="rsvp-attendees-heading">{t.attendees}</h2><span>{t.order}</span></div>
        <button className={`${shared.secondaryButton} ${styles.refresh}`} type="button" onClick={refresh} disabled={state.status === "loading"}>
          <RefreshCw aria-hidden="true" />{t.refresh}
        </button>
      </div>
      <div className={styles.search}>
        <AdminListSearch value={query} onChange={setQuery} locale={locale} disabled={state.status !== "ready"} />
        <p>{t.searchHelp}</p>
      </div>
      {state.status === "loading" ? <p className={styles.message} role="status">{t.loading}</p>
        : state.status === "error" ? <div className={shared.stateMessage} role="alert"><p>{t.error}</p><button type="button" onClick={refresh}>{t.retry}</button></div>
          : filtered.length === 0 ? <div className={shared.stateMessage} role="status"><UsersRound aria-hidden="true" /><h3>{attendees.length ? t.noResults : t.empty}</h3>{attendees.length > 0 && <button type="button" onClick={() => setQuery("")}>{t.clear}</button>}</div>
            : <>
              <p id="rsvp-scroll-help" className={styles.scrollHelp}>{t.scroll}</p>
              <div className={styles.tableScroll} role="region" aria-label={t.attendees} aria-describedby="rsvp-scroll-help" tabIndex={0}>
                <table className={styles.table}>
                  <caption className={shared.srOnly}>{t.attendees} · {t.order}</caption>
                  <thead><tr>{[t.name, t.affiliation, t.occupation, t.contact, t.nationality, t.date].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
                  <tbody>{pagination.items.map(item => <tr key={item.id}>
                    <th scope="row"><strong>{item.koreanName}</strong><span lang="en">{item.englishName}</span></th>
                    <td>{item.affiliation}</td><td>{item.occupation}</td>
                    <td><span>{item.phone}</span><span className={styles.secondary}>{item.email}</span></td>
                    <td>{regions.of(item.nationality) ?? item.nationality}</td>
                    <td><time dateTime={item.createdAt}><span>{date.format(new Date(item.createdAt))}</span><span className={styles.secondary}>{time.format(new Date(item.createdAt))}</span></time></td>
                  </tr>)}</tbody>
                </table>
              </div>
              <AdminPagination {...pagination} locale={locale} />
            </>}
    </section>
  </AdminOperationsShell>;
}
