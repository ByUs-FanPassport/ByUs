"use client";
import { usePrivy } from "@privy-io/react-auth";
import {
  Check,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import { membershipPlatformLabel, type MembershipPlatform } from "@/features/certification/domain/certification";
import styles from "./certification-manager.module.css";
import { CertificationReviewWorkspace, reviewStatusLabel, type CertificationReviewSubmission as Submission, type ReviewStatus } from "./certification-review-workspace";

type Mission = {
  id: string;
  celebrityId: string;
  celebritySlug: string;
  immutableKey: string;
  revision: number;
  status: "draft" | "active" | "closed";
  category: string;
  titleKo: string;
  titleEn: string;
  descriptionKo: string;
  descriptionEn: string;
  instructionsKo: string;
  instructionsEn: string;
  opensAt: string;
  closesAt: string;
  reward: { scorePoints: number; ticketAmount: number; stampCount?: 1 };
  membershipPlatform?: MembershipPlatform;
};
const blank = {
  id: "",
  celebrityId: "",
  immutableKey: "",
  membershipPlatform: "" as MembershipPlatform | "",
  expectedRevision: undefined as number | undefined,
  category: "",
  titleKo: "",
  titleEn: "",
  descriptionKo: "",
  descriptionEn: "",
  instructionsKo: "",
  instructionsEn: "",
  opensAt: "",
  closesAt: "",
  scorePoints: 0,
  ticketAmount: 0,
};
function missionForm(mission: Mission): typeof blank {
  return {
    id: mission.id,
    celebrityId: mission.celebrityId,
    immutableKey: mission.immutableKey,
    membershipPlatform: mission.membershipPlatform ?? "",
    expectedRevision: mission.revision,
    category: mission.category,
    titleKo: mission.titleKo,
    titleEn: mission.titleEn,
    descriptionKo: mission.descriptionKo,
    descriptionEn: mission.descriptionEn,
    instructionsKo: mission.instructionsKo,
    instructionsEn: mission.instructionsEn,
    opensAt: mission.opensAt.slice(0, 16),
    closesAt: mission.closesAt.slice(0, 16),
    scorePoints: mission.reward.scorePoints,
    ticketAmount: mission.reward.ticketAmount,
  };
}

function membershipPreset(platform: MembershipPlatform) {
  const name = membershipPlatformLabel(platform);
  return {
    membershipPlatform: platform,
    category: "유료 멤버십",
    titleKo: `${name} 유료 멤버십 인증`,
    titleEn: `${name} paid membership verification`,
    descriptionKo: `${name} 유료 멤버십 상태를 인증하고 팬 점수와 멤버십 Stamp를 받으세요.`,
    descriptionEn: `Verify your paid ${name} membership to earn fan score and a Membership Stamp.`,
    instructionsKo: `${name}에서 가입한 멤버십의 정보 화면을 캡처해 주세요. 관리자가 자료를 확인한 뒤 스탬프와 점수를 지급합니다.`,
    instructionsEn: `Capture the membership information screen in ${name}. Your Stamp and fan score are awarded after an administrator approves your proof.`,
    scorePoints: 1,
    ticketAmount: 0,
  };
}
export function AuthorizedCertificationManager() {
  const locale = useSearchParams().get("lang") === "en" ? "en" : "ko";
  const session = useAdminSession();
  const { user } = usePrivy();
  if (session.status !== "authorized")
    return <AdminAccessState locale={locale} status={session.status} />;
  return (
    <CertificationManager
      key={`${user?.id ?? session.admin.email}:${session.admin.role}`}
      locale={locale}
      canWrite={session.admin.role !== "viewer"}
      adminRole={session.admin.role}
    />
  );
}
function CertificationManager({
  locale,
  canWrite,
  adminRole,
}: {
  locale: "ko" | "en";
  canWrite: boolean;
  adminRole: string;
}) {
  const { getAccessToken } = usePrivy();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [queue, setQueue] = useState<Submission[]>([]);
  const [form, setForm] = useState(() => ({ ...blank, immutableKey: `cert-${crypto.randomUUID()}` }));
  const [tab, setTab] = useState<"review" | "missions">("review");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [fatalAccess, setFatalAccess] = useState<"denied" | "unauthenticated" | null>(null);
  const loadVersion = useRef(0);
  const [creators, setCreators] = useState<{ id: string; slug: string; localizations: { ko: { name: string }; en: { name: string } } }[]>([]);
  const [creatorSearch, setCreatorSearch] = useState("");
  const [creatorError, setCreatorError] = useState(false);
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [pending, setPending] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const pendingRef = useRef(false);
  const reconcileMissionIdRef = useRef<string | null>(null);
  const reviewKeysRef = useRef(new Map<string, { fingerprint: string; key: string }>());
  const request = useCallback(
    async (url: string, method = "GET", body?: unknown, signal?: AbortSignal) => {
      const requestSignal = signal ? AbortSignal.any([signal, lifetime.current.signal]) : lifetime.current.signal;
      if (requestSignal.aborted) throw new DOMException("Aborted", "AbortError");
      const token = await getAccessToken();
      if (requestSignal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!token) { setFatalAccess("unauthenticated"); throw new Error("Authentication required"); }
      const response = await fetch(url, {
        method,
        signal: requestSignal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) setFatalAccess(response.status === 401 ? "unauthenticated" : "denied");
      if (!response.ok) throw new Error();
      return response.json();
    },
    [getAccessToken],
  );
  const refresh = useCallback(async (reconcileMissionId?: string) => {
    const version = ++loadVersion.current;
    setLoading(true); setLoadError(false);
    try {
      const [m, q] = await Promise.all([
        request("/api/admin/certification-missions"),
        request(`/api/admin/certification-submissions?status=${reviewStatus}`),
      ]);
      if (version !== loadVersion.current) return false;
      setMissions(m.missions ?? []);
      setQueue(q.submissions ?? []);
      if (reconcileMissionId) {
        const confirmed = (m.missions ?? []).find((mission: Mission) => mission.id === reconcileMissionId);
        if (confirmed) setForm(missionForm(confirmed));
      }
      return true;
    } catch {
      if (version !== loadVersion.current) return false;
      setQueue([]); setLoadError(true);
      setMessageIsError(true);
      setMessage(
        locale === "ko"
          ? "인증 운영 데이터를 불러오지 못했습니다."
          : "Could not load certification operations.",
      );
      return false;
    } finally { if (version === loadVersion.current) setLoading(false); }
  }, [locale, request, reviewStatus]);
  useEffect(() => {
    void refresh();
    return () => { loadVersion.current += 1; };
  }, [refresh]);
  useEffect(() => {
    if (tab !== "missions") return;
    const controller = new AbortController();
    setCreatorError(false);
    void request("/api/admin/celebrities", "GET", undefined, controller.signal).then(payload => {
      if (!controller.signal.aborted) setCreators(payload.items ?? []);
    }).catch(() => { if (!controller.signal.aborted) setCreatorError(true); });
    return () => controller.abort();
  }, [request, tab]);
  function select(m: Mission) {
    setForm(missionForm(m));
  }
  async function command(body: unknown) {
    if (pendingRef.current || needsRefresh) return;
    pendingRef.current = true;
    setPending(true);
    setMessageIsError(false);
    setMessage(locale === "ko" ? "처리 중입니다." : "Processing.");
    let postSucceeded = false;
    try {
      const result = await request("/api/admin/certification-missions", "POST", body);
      postSucceeded = true;
      setNeedsRefresh(true);
      const reconcileId = form.id || result.mission?.id || result.id;
      reconcileMissionIdRef.current = reconcileId || null;
      if (!(await refresh(reconcileId))) throw new Error("refresh failed");
      reconcileMissionIdRef.current = null;
      setNeedsRefresh(false);
      setMessageIsError(false);
      setMessage(locale === "ko" ? "저장했습니다." : "Saved.");
    } catch {
      setMessageIsError(true);
      setMessage(
        postSucceeded
          ? locale === "ko"
            ? "변경은 처리됐지만 최신 상태를 불러오지 못했습니다."
            : "The change was processed, but the latest state could not be loaded."
          : locale === "ko"
          ? "처리하지 못했습니다. 버전과 필수 항목을 확인하세요."
          : "Could not complete the operation.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { membershipPlatform, ...fields } = form;
    await command({
      command: "save",
      ...fields,
      ...(membershipPlatform ? { membershipPlatform } : {}),
      id: form.id || undefined,
      opensAt: new Date(form.opensAt).toISOString(),
      closesAt: new Date(form.closesAt).toISOString(),
    });
  }
  async function review(item: Submission, decision: "approve" | "reject", reason?: string) {
    if (pendingRef.current || needsRefresh || !canWrite || item.status !== "pending") return;
    pendingRef.current = true;
    setPending(true);
    setMessageIsError(false);
    setMessage(locale === "ko" ? "검토 결과를 처리 중입니다." : "Saving review.");
    const rejectionReason = decision === "reject" ? reason : undefined;
    const fingerprint = JSON.stringify({ decision, expectedRevision: item.revision, rejectionReason });
    const savedKey = reviewKeysRef.current.get(item.id);
    const idem = savedKey?.fingerprint === fingerprint ? savedKey.key : crypto.randomUUID();
    reviewKeysRef.current.set(item.id, { fingerprint, key: idem });
    let postSucceeded = false;
    setNeedsRefresh(true);
    try {
      await request(
        `/api/admin/certification-submissions/${item.id}/review`,
        "POST",
        {
          idem,
          expectedRevision: item.revision,
          decision,
          rejectionReason,
        },
      );
      postSucceeded = true;
      reviewKeysRef.current.delete(item.id);
      setNeedsRefresh(true);
      reconcileMissionIdRef.current = form.id || null;
      if (!(await refresh(reconcileMissionIdRef.current || undefined))) throw new Error("refresh failed");
      reconcileMissionIdRef.current = null;
      setNeedsRefresh(false);
      setMessageIsError(false);
      setMessage(locale === "ko" ? "검토 결과를 반영했습니다." : "Review saved.");
    } catch {
      setMessageIsError(true);
      setMessage(
        postSucceeded
          ? locale === "ko"
            ? "변경은 처리됐지만 최신 상태를 불러오지 못했습니다."
            : "The change was processed, but the latest state could not be loaded."
          : locale === "ko" ? "심사 결과를 확인하지 못했습니다. 최신 상태를 불러온 뒤 다시 확인해 주세요." : "The review result is uncertain. Refresh the latest state before continuing.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function refreshFromButton() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMessageIsError(false);
    setMessage(locale === "ko" ? "최신 상태를 불러오는 중입니다." : "Loading latest state.");
    try {
      if (!(await refresh(needsRefresh ? reconcileMissionIdRef.current || form.id || undefined : undefined))) return;
      reconcileMissionIdRef.current = null;
      setNeedsRefresh(false);
      setMessage(locale === "ko" ? "최신 상태를 불러왔습니다." : "Latest state loaded.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  const loadProof = useCallback(async (submissionId: string, uploadId: string, signal: AbortSignal) => {
    const token = await getAccessToken();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!token) { setFatalAccess("unauthenticated"); throw new Error("Authentication required"); }
    const response = await fetch(`/api/admin/certification-submissions/${submissionId}/proofs/${uploadId}`, {
      headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal,
    });
    if (response.status === 401 || response.status === 403) setFatalAccess(response.status === 401 ? "unauthenticated" : "denied");
    if (!response.ok) throw new Error("Proof unavailable");
    return response.blob();
  }, [getAccessToken]);
  if (fatalAccess) return <AdminAccessState locale={locale} status={fatalAccess} />;
  return (
    <AdminOperationsShell locale={locale} adminRole={adminRole}>
      <main className={styles.page}>
        <header>
          <p>{locale === "ko" ? "회원 인증" : "Member verification"}</p>
          <h1>
            {locale === "ko" ? "인증 심사" : "Certification reviews"}
          </h1>
          <span>
            {locale === "ko"
              ? "팬이 제출한 이미지를 확인하고 인증 결과를 알려 주세요."
              : "Review submitted images and let fans know the result."}
          </span>
        </header>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label={locale === "ko" ? "인증 관리" : "Certification management"} onKeyDown={event => {
            if (pending || needsRefresh || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "review" : event.key === "End" ? "missions" : tab === "review" ? "missions" : "review";
            setTab(next); document.getElementById(`${next}-tab`)?.focus();
          }}>
            <button id="review-tab" aria-controls="review-panel" role="tab" aria-selected={tab === "review"} tabIndex={tab === "review" ? 0 : -1} type="button" disabled={pending || needsRefresh} onClick={() => setTab("review")}>{locale === "ko" ? "인증 심사" : "Reviews"}</button>
            <button id="missions-tab" aria-controls="missions-panel" role="tab" aria-selected={tab === "missions"} tabIndex={tab === "missions" ? 0 : -1} type="button" disabled={pending || needsRefresh} onClick={() => setTab("missions")}>{locale === "ko" ? "미션 설정" : "Mission settings"}</button>
          </div>
          <button type="button" disabled={pending || loading} onClick={() => void refreshFromButton()}><RefreshCw aria-hidden="true" />{needsRefresh ? (locale === "ko" ? "최신 상태 불러오기" : "Load latest state") : (locale === "ko" ? "새로고침" : "Refresh")}</button>
        </div>
        <p role={messageIsError ? "alert" : "status"} className={styles.message} data-error={messageIsError}>{message}</p>
        {tab === "review" ? <div id="review-panel" role="tabpanel" aria-labelledby="review-tab">
          <div className={styles.statusTabs} role="group" aria-label={locale === "ko" ? "심사 상태" : "Review status"}>{(["pending", "rejected", "approved"] as const).map(status => <button type="button" key={status} aria-pressed={reviewStatus === status} disabled={pending || needsRefresh || loading} onClick={() => { setQueue([]); setReviewStatus(status); }}>{reviewStatusLabel(status, locale)}</button>)}</div>
          {loading ? <p className={styles.loadState}>{locale === "ko" ? "인증 자료를 불러오는 중입니다…" : "Loading submissions…"}</p> : loadError ? <p className={styles.loadState}>{locale === "ko" ? "자료를 불러오지 못했습니다. 새로고침해 주세요." : "Could not load submissions. Please refresh."}</p> : <CertificationReviewWorkspace key={reviewStatus} submissions={queue} locale={locale} status={reviewStatus} busy={pending || needsRefresh} canWrite={canWrite} loadProof={loadProof} onReview={review} />}
        </div> : <div id="missions-panel" role="tabpanel" aria-labelledby="missions-tab">
        <div className={styles.workspace}>
          <section className={styles.missions}>
            <div className={styles.sectionHeading}>
              <h2>{locale === "ko" ? "인증 미션" : "Missions"}</h2>
              <button type="button" disabled={pending || needsRefresh} onClick={() => setForm({ ...blank, immutableKey: `cert-${crypto.randomUUID()}` })}>
                <Plus /> {locale === "ko" ? "새 미션" : "New"}
              </button>
            </div>
            {missions.map((m) => (
              <button
                type="button"
                key={m.id}
                disabled={pending || needsRefresh}
                onClick={() => select(m)}
                aria-pressed={form.id === m.id}
              >
                <span>
                  <strong>{locale === "ko" ? m.titleKo : m.titleEn}</strong>
                  <small>
                    {m.celebritySlug}{m.membershipPlatform ? ` · ${membershipPlatformLabel(m.membershipPlatform)}` : ""} · {locale === "ko" ? "버전" : "v"} {m.revision}
                  </small>
                </span>
                <em data-status={m.status}>{locale === "ko" ? { active: "진행 중", draft: "초안", closed: "종료" }[m.status] : { active: "Active", draft: "Draft", closed: "Closed" }[m.status]}</em>
              </button>
            ))}
          </section>
          <form className={styles.editor} onSubmit={save}>
            <h2>
              {form.id
                ? locale === "ko"
                  ? "미션 편집"
                  : "Edit mission"
                : locale === "ko"
                  ? "새 미션"
                  : "New mission"}
            </h2>
            <label>
              <span>{locale === "ko" ? "인증 유형" : "Certification type"}</span>
              <select
                value={form.membershipPlatform}
                disabled={!canWrite || pending || needsRefresh || Boolean(form.id)}
                onChange={(event) => {
                  const platform = event.target.value as MembershipPlatform | "";
                  setForm((value) => platform
                    ? { ...value, ...membershipPreset(platform) }
                    : { ...value, membershipPlatform: "" });
                }}
              >
                <option value="">{locale === "ko" ? "일반 수동 인증" : "Generic manual proof"}</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>
            <label><span>{locale === "ko" ? "크리에이터 검색" : "Search creators"}</span><input value={creatorSearch} disabled={!canWrite || pending || needsRefresh} onChange={event => setCreatorSearch(event.target.value)} placeholder={locale === "ko" ? "이름 또는 계정으로 검색" : "Search by name or handle"} /></label>
            <label><span>{locale === "ko" ? "크리에이터" : "Creator"}</span><select required value={form.celebrityId} disabled={!canWrite || pending || needsRefresh || Boolean(form.id)} onChange={event => setForm(value => ({ ...value, celebrityId: event.target.value }))}><option value="">{locale === "ko" ? "크리에이터 선택" : "Select a creator"}</option>{form.celebrityId && !creators.some(item => item.id === form.celebrityId) ? <option value={form.celebrityId}>{missions.find(item => item.id === form.id)?.celebritySlug || (locale === "ko" ? "선택한 크리에이터" : "Selected creator")}</option> : null}{creators.filter(item => item.id === form.celebrityId || `${item.slug} ${item.localizations.ko.name} ${item.localizations.en.name}`.toLowerCase().includes(creatorSearch.trim().toLowerCase())).map(item => <option key={item.id} value={item.id}>{item.localizations[locale].name} · @{item.slug}</option>)}</select>{creatorError ? <small>{locale === "ko" ? "크리에이터를 불러오지 못했습니다. 심사 탭으로 이동한 뒤 다시 열어 주세요." : "Could not load creators. Reopen this tab to retry."}</small> : null}</label>
            <div className={styles.grid}>
              {Object.entries({
                category: locale === "ko" ? "카테고리" : "Category",
                titleKo: locale === "ko" ? "제목 (한국어)" : "Title (Korean)",
                titleEn: locale === "ko" ? "제목 (영어)" : "Title (English)",
              }).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    required
                    value={String(form[key as keyof typeof form] ?? "")}
                    disabled={
                      !canWrite || pending || needsRefresh || Boolean(form.id && key === "immutableKey")
                    }
                    onChange={(e) =>
                      setForm((v) => ({ ...v, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                <span>{locale === "ko" ? "시작 일시" : "Starts at"}</span>
                <input
                  required
                  type="datetime-local"
                  disabled={!canWrite || pending || needsRefresh}
                  value={form.opensAt}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, opensAt: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>{locale === "ko" ? "종료 일시" : "Ends at"}</span>
                <input
                  required
                  type="datetime-local"
                  disabled={!canWrite || pending || needsRefresh}
                  value={form.closesAt}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, closesAt: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>{locale === "ko" ? "팬 점수" : "Fan score"}</span>
                <input
                  required
                  type="number"
                  disabled={!canWrite || pending || needsRefresh}
                  min="0"
                  max="100"
                  value={form.scorePoints}
                  onChange={(e) =>
                    setForm((v) => ({
                      ...v,
                      scorePoints: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>{locale === "ko" ? "응모권 수량" : "Ticket quantity"}</span>
                <input
                  required
                  type="number"
                  disabled={!canWrite || pending || needsRefresh}
                  min="0"
                  max="1000000"
                  value={form.ticketAmount}
                  onChange={(e) =>
                    setForm((v) => ({
                      ...v,
                      ticketAmount: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
            {(
              [
                "descriptionKo",
                "descriptionEn",
                "instructionsKo",
                "instructionsEn",
              ] as const
            ).map((key) => (
              <label key={key}>
                <span>{locale === "ko" ? { descriptionKo: "설명 (한국어)", descriptionEn: "설명 (영어)", instructionsKo: "인증 안내 (한국어)", instructionsEn: "인증 안내 (영어)" }[key] : { descriptionKo: "Description (Korean)", descriptionEn: "Description (English)", instructionsKo: "Instructions (Korean)", instructionsEn: "Instructions (English)" }[key]}</span>
                <textarea
                  required
                  disabled={!canWrite || pending || needsRefresh}
                  value={form[key]}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <details className={styles.advanced}><summary>{locale === "ko" ? "미션 식별 정보" : "Mission identifiers"}</summary><p>{form.immutableKey}</p>{form.id ? <p>{form.id}</p> : null}</details>
            <div className={styles.actions}>
              <button type="submit" disabled={!canWrite || pending || needsRefresh}>
                <Save />
                {locale === "ko" ? "초안 저장" : "Save draft"}
              </button>
              {form.id ? (
                <>
                  <button
                    type="button"
                    disabled={!canWrite || pending || needsRefresh}
                    onClick={() =>
                      void command({
                        command: "activate",
                        id: form.id,
                        expectedRevision: form.expectedRevision,
                      })
                    }
                  >
                    <Check />
                    {locale === "ko" ? "활성화" : "Activate"}
                  </button>
                  <button
                    type="button"
                    disabled={!canWrite || pending || needsRefresh}
                    onClick={() =>
                      void command({
                        command: "close",
                        id: form.id,
                        expectedRevision: form.expectedRevision,
                      })
                    }
                  >
                    <X />
                    {locale === "ko" ? "종료" : "Close"}
                  </button>
                </>
              ) : null}
            </div>
          </form>
        </div>
        </div>}
      </main>
    </AdminOperationsShell>
  );
}
