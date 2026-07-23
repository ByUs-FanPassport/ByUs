"use client";

import {
  AlertCircle,
  ChevronRight,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import { Drawer } from "../ui/overlay/accessible-overlay";
import ops from "./operations.module.css";
import styles from "./fan-operations.module.css";

type Journey = {
  passportId: string;
  celebrity: { id: string; name: string; archived: boolean };
  score: { points: number; level: string };
  activityCounts: Record<
    "knowledge" | "reservation" | "attendance" | "survey",
    number
  >;
  passportMintStatus: string;
  benefitSummary: { claims: number; applications: number };
};
type Fan = {
  fanId: string;
  nickname: string | null;
  accountStatus: "active" | "disabled";
  maskedWallet: string | null;
  celebritySummaries: Journey[];
};
type Passport = {
  id: string;
  celebrity: Journey["celebrity"];
  mintStatus: string;
  score: { points: number };
  activities: Array<{
    id: string;
    type: string;
    occurredAt: string;
    points: number | null;
  }>;
  scoreLedger: Array<{
    id: string;
    source: string;
    points: number;
    reason: string | null;
    createdAt: string;
  }>;
  stamps: Array<{
    id: string;
    type: string;
    mintStatus: string;
    issuedAt: string;
  }>;
  benefitClaims: Array<{ id: string; title: string; claimedAt: string }>;
  benefitApplications: Array<{
    id: string;
    title: string;
    status: string;
    submittedAt: string;
  }>;
  correctionAllowed: boolean;
};
type FanDetail = {
  fanId: string;
  nickname: string | null;
  accountStatus: "active" | "disabled";
  wallets: Array<{ chainId: number; maskedAddress: string }>;
  passports: Passport[];
};
const copy = {
  ko: {
    eyebrow: "혜택 운영",
    title: "팬 운영",
    description:
      "팬의 Passport 여정과 발급·혜택 상태를 최소 정보로 확인합니다.",
    privacy:
      "검색에 사용한 이메일은 결과, 상세, 감사 로그에 표시되지 않습니다. Google 실명과 원문 지갑 주소도 노출하지 않습니다.",
    query: "닉네임 또는 정확한 이메일",
    status: "계정 상태",
    all: "전체",
    active: "활성",
    disabled: "비활성",
    search: "검색",
    reset: "초기화",
    loading: "팬 목록을 불러오는 중입니다.",
    empty: "조건에 맞는 팬이 없습니다.",
    error: "팬 정보를 불러오지 못했습니다.",
    retry: "다시 시도",
    fan: "팬",
    journey: "Passport 여정",
    score: "Score",
    activity: "활동",
    benefit: "혜택",
    detail: "팬 상세",
    close: "상세 닫기",
    ledger: "Score 원장",
    stamps: "Stamp",
    benefits: "혜택 상태",
    none: "기록 없음",
    adjust: "점수 교정",
    adjustHelp: "기존 점수를 덮어쓰지 않고 +/- 원장 행을 영구 추가합니다.",
    points: "조정값 (-100~100)",
    reason: "교정 사유",
    confirm: "이 교정이 불변 원장과 감사 로그에 영구 기록됨을 확인합니다.",
    submit: "교정 기록",
    saved: "교정이 기록되었습니다.",
    saveError: "교정을 기록하지 못했습니다.",
    viewer: "Viewer는 팬 상태를 읽기만 할 수 있습니다.",
    unavailable: "비활성 팬 또는 보관된 셀럽은 교정할 수 없습니다.",
  },
  en: {
    eyebrow: "Benefit operations",
    title: "Fan operations",
    description:
      "Review Passport journeys, issuance, and benefit states with minimum fan data.",
    privacy:
      "Email is used only for exact search and never appears in results, details, or audit logs. Google names and full wallet addresses are excluded.",
    query: "Nickname or exact email",
    status: "Account status",
    all: "All",
    active: "Active",
    disabled: "Disabled",
    search: "Search",
    reset: "Reset",
    loading: "Loading fans.",
    empty: "No fans match these filters.",
    error: "Fan data could not be loaded.",
    retry: "Try again",
    fan: "Fan",
    journey: "Passport journey",
    score: "Score",
    activity: "Activity",
    benefit: "Benefits",
    detail: "Fan detail",
    close: "Close detail",
    ledger: "Score ledger",
    stamps: "Stamps",
    benefits: "Benefit state",
    none: "No records",
    adjust: "Correct score",
    adjustHelp: "Adds a permanent +/- ledger entry without overwriting score.",
    points: "Delta (-100 to 100)",
    reason: "Correction reason",
    confirm:
      "I confirm this correction is permanently recorded in the ledger and audit log.",
    submit: "Record correction",
    saved: "Correction recorded.",
    saveError: "Correction could not be recorded.",
    viewer: "Viewers have read-only access.",
    unavailable: "Disabled fans and archived celebrities cannot be corrected.",
  },
} as const;
function formatDate(value: string, locale: AdminLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function FanOperations() {
  const params = useSearchParams(),
    router = useRouter(),
    { getAccessToken } = usePrivy(),
    session = useAdminSession();
  const locale: AdminLocale = params.get("lang") === "en" ? "en" : "ko",
    t = copy[locale],
    query = params.get("q") ?? "",
    status = params.get("status") ?? "";
  const [fans, setFans] = useState<Fan[]>([]),
    [selected, setSelected] = useState<Fan | null>(null),
    [detail, setDetail] = useState<FanDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"),
    [passportId, setPassportId] = useState(""),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState<"saved" | "error" | null>(null);
  const adjustmentAttempt = useRef<{ payload: string; key: string } | null>(
    null,
  );
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openRequestId = useRef(0);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error();
      const search = new URLSearchParams({ limit: "50", lang: locale });
      if (query) search.set("q", query);
      if (status) search.set("status", status);
      const response = await fetch(`/api/admin/fans?${search}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { items: Fan[] };
      setFans(body.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [getAccessToken, locale, query, status]);
  useEffect(() => {
    if (session.status === "authorized") void load();
  }, [load, session.status]);
  async function open(fan: Fan) {
    const requestId = ++openRequestId.current;
    setSelected(fan);
    setDetail(null);
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error();
      const response = await fetch(
        `/api/admin/fans/${fan.fanId}?lang=${locale}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { fan: FanDetail };
      if (openRequestId.current !== requestId) return;
      setDetail(body.fan);
      setPassportId(body.fan.passports[0]?.id ?? "");
      setState("ready");
    } catch {
      if (openRequestId.current !== requestId) return;
      setState("error");
    }
  }
  const closeDrawer = useCallback(() => {
    if (saving) return;
    openRequestId.current += 1;
    setSelected(null);
    setDetail(null);
  }, [saving]);
  function apply(form: FormData) {
    const next = new URLSearchParams();
    if (locale === "en") next.set("lang", "en");
    const q = String(form.get("q") ?? "").trim(),
      s = String(form.get("status") ?? "");
    if (q) next.set("q", q);
    if (s) next.set("status", s);
    router.replace(`/admin/fans${next.size ? `?${next}` : ""}` as Route, {
      scroll: false,
    });
  }
  const current = useMemo(
    () =>
      detail?.passports.find((item) => item.id === passportId) ??
      detail?.passports[0] ??
      null,
    [detail, passportId],
  );
  async function adjust(form: FormData) {
    if (!selected || !current) return;
    setSaving(true);
    setMessage(null);
    const input = {
      celebrityId: current.celebrity.id,
      points: Number(form.get("points")),
      reason: String(form.get("reason")).trim(),
    };
    const payload = JSON.stringify(input);
    if (adjustmentAttempt.current?.payload !== payload)
      adjustmentAttempt.current = { payload, key: crypto.randomUUID() };
    try {
      const token = await getAccessToken();
      if (!token) throw new Error();
      const response = await fetch(
        `/api/admin/fans/${selected.fanId}/score-adjustments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-correlation-id": crypto.randomUUID(),
          },
          body: JSON.stringify({
            ...input,
            idempotencyKey: adjustmentAttempt.current.key,
          }),
        },
      );
      if (!response.ok) throw new Error();
      adjustmentAttempt.current = null;
      setMessage("saved");
      await open(selected);
      await load();
    } catch {
      setMessage("error");
    } finally {
      setSaving(false);
    }
  }
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  return (
    <AdminOperationsShell locale={locale}>
      <header className={ops.pageHeading}>
        <p>{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <span>{t.description}</span>
      </header>
      <div className={styles.privacyNote}>
        <ShieldCheck aria-hidden="true" />
        <span>{t.privacy}</span>
      </div>
      <form className={ops.filterBar} action={apply}>
        <label className={ops.growField}>
          <span>{t.query}</span>
          <input name="q" defaultValue={query} minLength={2} maxLength={100} />
        </label>
        <label>
          <span>{t.status}</span>
          <select name="status" defaultValue={status}>
            <option value="">{t.all}</option>
            <option value="active">{t.active}</option>
            <option value="disabled">{t.disabled}</option>
          </select>
        </label>
        <button className={ops.primaryButton} type="submit">
          <Search aria-hidden="true" />
          {t.search}
        </button>
        <button
          className={ops.textButton}
          type="button"
          onClick={() =>
            router.replace(
              (locale === "en"
                ? "/admin/fans?lang=en"
                : "/admin/fans") as Route,
            )
          }
        >
          {t.reset}
        </button>
      </form>
      {state === "loading" && !selected && (
        <div className={ops.skeletonList} aria-label={t.loading}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} />
          ))}
        </div>
      )}
      {state === "error" && !selected && (
        <State
          title={t.error}
          action={
            <button type="button" onClick={() => void load()}>
              {t.retry}
            </button>
          }
        />
      )}
      {state === "ready" && fans.length === 0 && <State title={t.empty} />}
      {fans.length > 0 && (
        <FanTable fans={fans} locale={locale} labels={t} open={open} />
      )}
      {selected && (
        <Drawer
          open
          onClose={closeDrawer}
          labelledBy="fan-title"
          backdropClassName={ops.drawerBackdrop}
          contentClassName={`${ops.drawer} ${styles.drawerWide}`}
          initialFocusRef={closeButtonRef}
          busy={saving}
        >
            <div className={ops.drawerHeader}>
              <div>
                <p>{selected.fanId}</p>
                <h2 id="fan-title">{selected.nickname ?? t.detail}</h2>
              </div>
              <button
                ref={closeButtonRef}
                className={ops.iconButton}
                type="button"
                aria-label={t.close}
                disabled={saving}
                onClick={closeDrawer}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className={ops.drawerBody}>
              {!detail && state === "loading" && (
                <div className={ops.skeletonList}>
                  {[1, 2, 3].map((n) => (
                    <div key={n} />
                  ))}
                </div>
              )}
              {!detail && state === "error" && <State title={t.error} />}{" "}
              {detail && (
                <>
                  <div className={styles.summaryRail}>
                    <span
                      className={
                        detail.accountStatus === "active"
                          ? styles.accountActive
                          : styles.accountDisabled
                      }
                    >
                      {detail.accountStatus}
                    </span>
                    {detail.wallets.map((wallet) => (
                      <span key={`${wallet.chainId}-${wallet.maskedAddress}`}>
                        {wallet.maskedAddress}
                      </span>
                    ))}
                  </div>
                  {detail.passports.length > 0 && (
                    <select
                      className={styles.journeySwitcher}
                      aria-label={t.journey}
                      value={current?.id ?? ""}
                      disabled={saving}
                      onChange={(event) => setPassportId(event.target.value)}
                    >
                      {detail.passports.map((passport) => (
                        <option key={passport.id} value={passport.id}>
                          {passport.celebrity.name} · {passport.mintStatus}
                        </option>
                      ))}
                    </select>
                  )}
                  {current && (
                    <JourneyDetail
                      current={current}
                      locale={locale}
                      labels={t}
                      role={session.admin.role}
                      saving={saving}
                      message={message}
                      adjust={adjust}
                    />
                  )}
                </>
              )}
            </div>
        </Drawer>
      )}
    </AdminOperationsShell>
  );
}

function FanTable({
  fans,
  locale,
  labels,
  open,
}: {
  fans: Fan[];
  locale: AdminLocale;
  labels: (typeof copy)["ko"] | (typeof copy)["en"];
  open: (fan: Fan) => Promise<void>;
}) {
  return (
    <div className={ops.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>{labels.fan}</th>
            <th>{labels.journey}</th>
            <th>{labels.score}</th>
            <th>{labels.activity}</th>
            <th>{labels.benefit}</th>
            <th>
              <span className={ops.srOnly}>{labels.detail}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {fans.map((fan) => {
            const journey = fan.celebritySummaries[0],
              activities = journey
                ? Object.values(journey.activityCounts).reduce(
                    (a, b) => a + b,
                    0,
                  )
                : 0;
            return (
              <tr key={fan.fanId}>
                <td>
                  <div className={styles.fanCell}>
                    <span className={styles.avatar}>
                      <UserRound aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{fan.nickname ?? "—"}</strong>
                      <span>{fan.maskedWallet ?? "—"}</span>
                    </span>
                  </div>
                </td>
                <td>
                  <div className={styles.journeyCell}>
                    <strong>{journey?.celebrity.name ?? "—"}</strong>
                    <span>
                      {fan.celebritySummaries.length > 1
                        ? `+${fan.celebritySummaries.length - 1} · `
                        : ""}
                      {journey?.passportMintStatus ?? "—"}
                    </span>
                  </div>
                </td>
                <td className={styles.score}>
                  {journey?.score.points ?? 0} · {journey?.score.level ?? "—"}
                </td>
                <td>{activities}</td>
                <td>
                  {(journey?.benefitSummary.claims ?? 0) +
                    (journey?.benefitSummary.applications ?? 0)}
                </td>
                <td>
                  <button
                    className={ops.iconButton}
                    type="button"
                    aria-label={`${labels.detail}: ${fan.nickname ?? fan.fanId}`}
                    onClick={() => void open(fan)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function JourneyDetail({
  current,
  locale,
  labels,
  role,
  saving,
  message,
  adjust,
}: {
  current: Passport;
  locale: AdminLocale;
  labels: (typeof copy)["ko"] | (typeof copy)["en"];
  role: string;
  saving: boolean;
  message: "saved" | "error" | null;
  adjust: (form: FormData) => Promise<void>;
}) {
  const benefits = [
    ...current.benefitClaims.map((item) => ({
      id: item.id,
      title: `${item.title} · claimed`,
      date: item.claimedAt,
    })),
    ...current.benefitApplications.map((item) => ({
      id: item.id,
      title: `${item.title} · ${item.status}`,
      date: item.submittedAt,
    })),
  ];
  return (
    <>
      <dl className={ops.detailGrid}>
        <div>
          <dt>{labels.score}</dt>
          <dd>{current.score.points}</dd>
        </div>
        <div>
          <dt>Passport NFT</dt>
          <dd>{current.mintStatus}</dd>
        </div>
      </dl>
      <Section title={labels.activity} empty={labels.none}>
        {current.activities.map((item) => (
          <li key={item.id}>
            <strong>
              {item.type}
              {item.points === null
                ? ""
                : ` · ${item.points > 0 ? "+" : ""}${item.points}`}
            </strong>
            <span>{formatDate(item.occurredAt, locale)}</span>
          </li>
        ))}
      </Section>
      <Section title={labels.ledger} empty={labels.none}>
        {current.scoreLedger.map((item) => (
          <li key={item.id}>
            <strong
              className={
                item.points >= 0 ? styles.deltaPositive : styles.deltaNegative
              }
            >
              {item.points > 0 ? "+" : ""}
              {item.points} · {item.source}
            </strong>
            <span>{item.reason ?? formatDate(item.createdAt, locale)}</span>
          </li>
        ))}
      </Section>
      <Section title={labels.stamps} empty={labels.none}>
        {current.stamps.map((item) => (
          <li key={item.id}>
            <strong>
              {item.type} · {item.mintStatus}
            </strong>
            <span>{formatDate(item.issuedAt, locale)}</span>
          </li>
        ))}
      </Section>
      <Section title={labels.benefits} empty={labels.none}>
        {benefits.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <span>{formatDate(item.date, locale)}</span>
          </li>
        ))}
      </Section>
      <section className={ops.detailSection}>
        <h3>{labels.adjust}</h3>
        <p>{labels.adjustHelp}</p>
        {role === "viewer" ? (
          <p>{labels.viewer}</p>
        ) : !current.correctionAllowed ? (
          <p>{labels.unavailable}</p>
        ) : (
          <form className={styles.correction} action={adjust}>
            <label>
              {labels.points}
              <input
                name="points"
                type="number"
                min={-100}
                max={100}
                required
              />
            </label>
            <label>
              {labels.reason}
              <textarea name="reason" minLength={10} maxLength={500} required />
            </label>
            <label className={styles.confirmCheck}>
              <input type="checkbox" required />
              <span>{labels.confirm}</span>
            </label>
            {message && (
              <p
                className={
                  message === "error" ? ops.inlineError : styles.deltaPositive
                }
                role="status"
              >
                {message === "saved" ? labels.saved : labels.saveError}
              </p>
            )}
            <div className={styles.correctionActions}>
              <button
                className={ops.primaryButton}
                type="submit"
                disabled={saving}
              >
                {saving ? "…" : labels.submit}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className={ops.detailSection}>
      <h3>{title}</h3>
      {children.length ? (
        <ul className={styles.sectionList}>{children}</ul>
      ) : (
        <p className={styles.emptySection}>{empty}</p>
      )}
    </section>
  );
}
function State({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <section className={ops.stateMessage}>
      <AlertCircle aria-hidden="true" />
      <h2>{title}</h2>
      {action}
    </section>
  );
}
