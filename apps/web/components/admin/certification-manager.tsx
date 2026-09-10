"use client";
import { usePrivy } from "@privy-io/react-auth";
import {
  Check,
  Image as ImageIcon,
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
import styles from "./certification-manager.module.css";

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
  reward: { scorePoints: number; ticketAmount: number };
};
type Submission = {
  id: string;
  missionId: string;
  missionTitle: string;
  celebritySlug: string;
  appUserId: string;
  status: "pending" | "approved" | "rejected";
  attemptNumber: number;
  note: string | null;
  revision: number;
  submittedAt: string;
  reward: { scorePoints: number; ticketAmount: number };
  uploads: { id: string; width: number; height: number }[];
};
const blank = {
  id: "",
  celebrityId: "",
  immutableKey: "",
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
function missionForm(mission: Mission) {
  return {
    id: mission.id,
    celebrityId: mission.celebrityId,
    immutableKey: mission.immutableKey,
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
export function AuthorizedCertificationManager() {
  const locale = useSearchParams().get("lang") === "en" ? "en" : "ko";
  const session = useAdminSession();
  if (session.status !== "authorized")
    return <AdminAccessState locale={locale} status={session.status} />;
  return (
    <CertificationManager
      locale={locale}
      canWrite={session.admin.role !== "viewer"}
    />
  );
}
function CertificationManager({
  locale,
  canWrite,
}: {
  locale: "ko" | "en";
  canWrite: boolean;
}) {
  const { getAccessToken } = usePrivy();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [queue, setQueue] = useState<Submission[]>([]);
  const [form, setForm] = useState(blank);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [pending, setPending] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const pendingRef = useRef(false);
  const reconcileMissionIdRef = useRef<string | null>(null);
  const reviewKeysRef = useRef(new Map<string, { fingerprint: string; key: string }>());
  const [reason, setReason] = useState<Record<string, string>>({});
  const request = useCallback(
    async (url: string, method = "GET", body?: unknown) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      return response.json();
    },
    [getAccessToken],
  );
  const refresh = useCallback(async (reconcileMissionId?: string) => {
    try {
      const [m, q] = await Promise.all([
        request("/api/admin/certification-missions"),
        request("/api/admin/certification-submissions?status=pending"),
      ]);
      setMissions(m.missions ?? []);
      setQueue(q.submissions ?? []);
      if (reconcileMissionId) {
        const confirmed = (m.missions ?? []).find((mission: Mission) => mission.id === reconcileMissionId);
        if (confirmed) setForm(missionForm(confirmed));
      }
      return true;
    } catch {
      setMessageIsError(true);
      setMessage(
        locale === "ko"
          ? "인증 운영 데이터를 불러오지 못했습니다."
          : "Could not load certification operations.",
      );
      return false;
    }
  }, [locale, request]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
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
    await command({
      command: "save",
      ...form,
      id: form.id || undefined,
      opensAt: new Date(form.opensAt).toISOString(),
      closesAt: new Date(form.closesAt).toISOString(),
    });
  }
  async function review(item: Submission, decision: "approve" | "reject") {
    if (pendingRef.current || needsRefresh) return;
    pendingRef.current = true;
    setPending(true);
    setMessageIsError(false);
    setMessage(locale === "ko" ? "검토 결과를 처리 중입니다." : "Saving review.");
    const rejectionReason = decision === "reject" ? reason[item.id] : undefined;
    const fingerprint = JSON.stringify({ decision, expectedRevision: item.revision, rejectionReason });
    const savedKey = reviewKeysRef.current.get(item.id);
    const idem = savedKey?.fingerprint === fingerprint ? savedKey.key : crypto.randomUUID();
    reviewKeysRef.current.set(item.id, { fingerprint, key: idem });
    let postSucceeded = false;
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
          : locale === "ko" ? "검토 결과를 반영하지 못했습니다." : "Review failed.",
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
  async function openProof(item: Submission, uploadId: string) {
    try {
      const token = await getAccessToken();
      const response = await fetch(
        `/api/admin/certification-submissions/${item.id}/proofs/${uploadId}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setMessage(
        locale === "ko"
          ? "인증 이미지를 열지 못했습니다."
          : "Could not open proof image.",
      );
    }
  }
  return (
    <AdminOperationsShell locale={locale}>
      <main className={styles.page}>
        <header>
          <p>Certification operations</p>
          <h1>
            {locale === "ko" ? "수동 팬 인증" : "Manual fan certification"}
          </h1>
          <span>
            {locale === "ko"
              ? "미션 조건, 고정 보상과 제출 자료를 관리합니다."
              : "Manage mission conditions, frozen rewards, and submitted proof."}
          </span>
        </header>
        <p role={messageIsError ? "alert" : "status"} className={styles.message}>
          {message}
        </p>
        <div className={styles.workspace}>
          <section className={styles.missions}>
            <div className={styles.sectionHeading}>
              <h2>{locale === "ko" ? "인증 미션" : "Missions"}</h2>
              <button type="button" disabled={pending || needsRefresh} onClick={() => setForm(blank)}>
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
                  <strong>{m.titleKo}</strong>
                  <small>
                    {m.celebritySlug} · r{m.revision}
                  </small>
                </span>
                <em data-status={m.status}>{m.status}</em>
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
            <div className={styles.grid}>
              {Object.entries({
                celebrityId: "Celebrity UUID",
                immutableKey: "Immutable key",
                category: locale === "ko" ? "카테고리" : "Category",
                titleKo: "제목",
                titleEn: "Title",
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
                <span>Open</span>
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
                <span>Close</span>
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
                <span>Score</span>
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
                <span>Tickets</span>
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
                <span>{key}</span>
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
        <section className={styles.queue}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{locale === "ko" ? "검토 대기" : "Review queue"}</h2>
              <p>{queue.length} pending</p>
            </div>
            <button type="button" disabled={pending} onClick={() => void refreshFromButton()}>
              <RefreshCw />
              {needsRefresh ? (locale === "ko" ? "최신 상태 불러오기" : "Load latest state") : (locale === "ko" ? "새로고침" : "Refresh")}
            </button>
          </div>
          {queue.length ? (
            queue.map((item) => (
              <article key={item.id}>
                <header>
                  <div>
                    <strong>{item.missionTitle}</strong>
                    <span>
                      {item.celebritySlug} · #{item.attemptNumber}
                    </span>
                    <span>Submission ID: {item.id}</span>
                  </div>
                  <span>
                    +{item.reward.scorePoints} score · +
                    {item.reward.ticketAmount} ticket
                  </span>
                </header>
                <div className={styles.proofs}>
                  {item.uploads.map((upload) => (
                    <button
                      type="button"
                      key={upload.id}
                      onClick={() => void openProof(item, upload.id)}
                    >
                      <ImageIcon />
                      <span>
                        {upload.width} × {upload.height}
                      </span>
                    </button>
                  ))}
                </div>
                {item.note ? <p>{item.note}</p> : null}
                <label>
                  <span>
                    {locale === "ko" ? "반려 사유" : "Rejection reason"}
                  </span>
                  <textarea
                    disabled={!canWrite || pending || needsRefresh}
                    value={reason[item.id] ?? ""}
                    onChange={(e) =>
                      setReason((v) => ({ ...v, [item.id]: e.target.value }))
                    }
                  />
                </label>
                <div className={styles.reviewActions}>
                  <button
                    type="button"
                    disabled={!canWrite || pending || needsRefresh}
                    onClick={() => void review(item, "approve")}
                  >
                    <Check />
                    {locale === "ko" ? "승인" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      !canWrite || pending || needsRefresh || (reason[item.id]?.trim().length ?? 0) < 3
                    }
                    onClick={() => void review(item, "reject")}
                  >
                    <X />
                    {locale === "ko" ? "반려" : "Reject"}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className={styles.empty}>
              {locale === "ko"
                ? "검토할 제출이 없습니다."
                : "No submissions to review."}
            </p>
          )}
        </section>
      </main>
    </AdminOperationsShell>
  );
}
