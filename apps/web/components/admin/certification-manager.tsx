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
import { useCallback, useEffect, useState } from "react";
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
  const [reason, setReason] = useState<Record<string, string>>({});
  const request = useCallback(
    async (url: string, method = "GET", body?: unknown) => {
      const token = await getAccessToken();
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
  const refresh = useCallback(async () => {
    try {
      const [m, q] = await Promise.all([
        request("/api/admin/certification-missions"),
        request("/api/admin/certification-submissions?status=pending"),
      ]);
      setMissions(m.missions ?? []);
      setQueue(q.submissions ?? []);
    } catch {
      setMessage(
        locale === "ko"
          ? "인증 운영 데이터를 불러오지 못했습니다."
          : "Could not load certification operations.",
      );
    }
  }, [locale, request]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  function select(m: Mission) {
    setForm({
      id: m.id,
      celebrityId: m.celebrityId,
      immutableKey: m.immutableKey,
      expectedRevision: m.revision,
      category: m.category,
      titleKo: m.titleKo,
      titleEn: m.titleEn,
      descriptionKo: m.descriptionKo,
      descriptionEn: m.descriptionEn,
      instructionsKo: m.instructionsKo,
      instructionsEn: m.instructionsEn,
      opensAt: m.opensAt.slice(0, 16),
      closesAt: m.closesAt.slice(0, 16),
      scorePoints: m.reward.scorePoints,
      ticketAmount: m.reward.ticketAmount,
    });
  }
  async function command(body: unknown) {
    try {
      await request("/api/admin/certification-missions", "POST", body);
      setMessage(locale === "ko" ? "저장했습니다." : "Saved.");
      await refresh();
    } catch {
      setMessage(
        locale === "ko"
          ? "처리하지 못했습니다. 버전과 필수 항목을 확인하세요."
          : "Could not complete the operation.",
      );
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
    try {
      await request(
        `/api/admin/certification-submissions/${item.id}/review`,
        "POST",
        {
          idem: crypto.randomUUID(),
          expectedRevision: item.revision,
          decision,
          rejectionReason: decision === "reject" ? reason[item.id] : undefined,
        },
      );
      setMessage(
        locale === "ko" ? "검토 결과를 반영했습니다." : "Review saved.",
      );
      await refresh();
    } catch {
      setMessage(
        locale === "ko" ? "검토 결과를 반영하지 못했습니다." : "Review failed.",
      );
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
        <p role="status" className={styles.message}>
          {message}
        </p>
        <div className={styles.workspace}>
          <section className={styles.missions}>
            <div className={styles.sectionHeading}>
              <h2>{locale === "ko" ? "인증 미션" : "Missions"}</h2>
              <button type="button" onClick={() => setForm(blank)}>
                <Plus /> {locale === "ko" ? "새 미션" : "New"}
              </button>
            </div>
            {missions.map((m) => (
              <button
                type="button"
                key={m.id}
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
                      !canWrite || Boolean(form.id && key === "immutableKey")
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
                  value={form[key]}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <div className={styles.actions}>
              <button type="submit" disabled={!canWrite}>
                <Save />
                {locale === "ko" ? "초안 저장" : "Save draft"}
              </button>
              {form.id ? (
                <>
                  <button
                    type="button"
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
            <button type="button" onClick={() => void refresh()}>
              <RefreshCw />
              {locale === "ko" ? "새로고침" : "Refresh"}
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
                    value={reason[item.id] ?? ""}
                    onChange={(e) =>
                      setReason((v) => ({ ...v, [item.id]: e.target.value }))
                    }
                  />
                </label>
                <div className={styles.reviewActions}>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => void review(item, "approve")}
                  >
                    <Check />
                    {locale === "ko" ? "승인" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      !canWrite || (reason[item.id]?.trim().length ?? 0) < 3
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
