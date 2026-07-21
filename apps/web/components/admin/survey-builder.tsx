"use client";
import { usePrivy } from "@privy-io/react-auth";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  Monitor,
  Plus,
  Save,
  Send,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SurveyBuilderDocument,
  SurveyQuestion,
} from "../../server/g5/survey-builder-repository";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./survey-builder.module.css";

type Question = SurveyQuestion & { clientId: string };
const copy = {
  ko: {
    eyebrow: "라이브 운영",
    title: "설문 빌더",
    description:
      "공통 질문 4개와 선택 질문 최대 2개로 한국어·영어 설문을 구성합니다.",
    versions: "버전",
    newVersion: "새 초안",
    clone: "복제",
    save: "초안 저장",
    publish: "발행",
    close: "마감",
    archive: "보관",
    preview: "미리보기",
    desktop: "PC",
    mobile: "모바일",
    add: "선택 질문 추가",
    viewer: "Viewer 역할은 설문을 조회하고 미리보기만 할 수 있습니다.",
    loading: "설문 구성을 불러오는 중입니다.",
    error: "설문을 불러오지 못했습니다.",
    empty: "아직 설문 버전이 없습니다.",
    emptyHelp: "새 초안을 만들면 공통 질문 4개가 자동으로 준비됩니다.",
    required: "필수",
    ko: "한국어",
    en: "English",
    options: "선택지",
    remove: "질문 삭제",
    published: "발행됨",
    draft: "초안",
    closed: "마감",
    archived: "보관",
    confirmPublish: "발행 후 질문과 선택지는 변경할 수 없습니다. 발행할까요?",
    confirmClose:
      "마감하면 팬이 더 이상 응답할 수 없으며 되돌릴 수 없습니다. 마감할까요?",
    confirmArchive: "보관한 설문 버전은 다시 활성화할 수 없습니다. 계속할까요?",
  },
  en: {
    eyebrow: "Live operations",
    title: "Survey builder",
    description:
      "Compose four canonical questions and up to two custom questions in Korean and English.",
    versions: "Versions",
    newVersion: "New draft",
    clone: "Clone",
    save: "Save draft",
    publish: "Publish",
    close: "Close",
    archive: "Archive",
    preview: "Preview",
    desktop: "Desktop",
    mobile: "Mobile",
    add: "Add custom question",
    viewer: "Viewer can review and preview surveys but cannot make changes.",
    loading: "Loading survey configuration.",
    error: "Survey configuration could not be loaded.",
    empty: "No survey version exists yet.",
    emptyHelp: "Create a draft to start with the four canonical questions.",
    required: "Required",
    ko: "한국어",
    en: "English",
    options: "Options",
    remove: "Remove question",
    published: "Published",
    draft: "Draft",
    closed: "Closed",
    archived: "Archived",
    confirmPublish:
      "Questions and options become immutable after publishing. Publish now?",
    confirmClose:
      "Closing permanently stops new fan responses and cannot be undone. Close now?",
    confirmArchive: "An archived survey version cannot be restored. Continue?",
  },
} as const;
function withIds(items: SurveyQuestion[]): Question[] {
  return items.map((q) => ({
    ...q,
    clientId: q.id ?? crypto.randomUUID(),
    options: q.options.map((o) => ({ ...o })),
  }));
}
function normalize(items: Question[]) {
  return items.map((q, i) => ({
    type: q.type,
    commonKey: q.commonKey,
    required: q.required,
    position: i + 1,
    text: q.text,
    options: q.options.map((o, j) => ({ position: j + 1, label: o.label })),
  }));
}

export function SurveyBuilder({ liveEventId }: { liveEventId: string }) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const params = useSearchParams();
  const locale: AdminLocale = params.get("lang") === "en" ? "en" : "ko";
  const t = copy[locale];
  const [document, setDocument] = useState<SurveyBuilderDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const selected = useMemo(
    () =>
      document?.versions.find((v) => v.id === selectedId) ??
      document?.versions[0] ??
      null,
    [document, selectedId],
  );
  const editable =
    selected?.status === "draft" &&
    session.status === "authorized" &&
    session.admin.role !== "viewer" &&
    !saving;
  const load = useCallback(async () => {
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw 0;
      const res = await fetch(`/api/admin/live-events/${liveEventId}/survey`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw 0;
      const body = (await res.json()) as { data: SurveyBuilderDocument };
      setDocument(body.data);
      const first = body.data.versions[0] ?? null;
      setSelectedId(first?.id ?? null);
      setQuestions(withIds(first?.questions ?? []));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [getAccessToken, liveEventId]);
  useEffect(() => {
    if (session.status === "authorized") void load();
  }, [session.status]);
  function choose(id: string) {
    const version = document?.versions.find((v) => v.id === id);
    setSelectedId(id);
    setQuestions(withIds(version?.questions ?? []));
    setMessage("");
  }
  async function command(
    command: string,
    payload: Record<string, unknown> = {},
  ) {
    setSaving(true);
    setMessage("");
    try {
      const token = await getAccessToken();
      if (!token) throw 0;
      const res = await fetch(`/api/admin/live-events/${liveEventId}/survey`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ command, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.code ?? "ERROR");
      setDocument(body.data);
      const target =
        body.data.versions.find(
          (v: SurveyBuilderDocument["versions"][number]) =>
            v.id ===
            (body.data.selectedSurveyId ?? payload.surveyId ?? selectedId),
        ) ?? body.data.versions[0];
      setSelectedId(target?.id ?? null);
      setQuestions(withIds(target?.questions ?? []));
      setMessage(
        locale === "ko" ? "변경사항을 반영했습니다." : "Changes saved.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : locale === "ko"
            ? "요청을 처리하지 못했습니다."
            : "Request failed.",
      );
    } finally {
      setSaving(false);
    }
  }
  function update(index: number, change: Partial<Question>) {
    setQuestions((items) =>
      items.map((q, i) => (i === index ? { ...q, ...change } : q)),
    );
  }
  function move(index: number, delta: number) {
    const next = [...questions];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setQuestions(next);
  }
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  return (
    <AdminOperationsShell locale={locale}>
      <header className={styles.heading}>
        <p>{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <span>{t.description}</span>
      </header>
      {session.admin.role === "viewer" && (
        <p className={styles.viewer}>{t.viewer}</p>
      )}
      {state === "loading" && <div className={styles.state}>{t.loading}</div>}
      {state === "error" && (
        <div className={styles.state}>
          <strong>{t.error}</strong>
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {state === "ready" && (
        <div className={styles.builder}>
          <aside className={styles.versions}>
            <div className={styles.sectionHead}>
              <h2>{t.versions}</h2>
              <button
                disabled={session.admin.role === "viewer" || saving}
                onClick={() => void command("create")}
              >
                <Plus />
                {t.newVersion}
              </button>
            </div>
            {document?.versions.map((v) => (
              <button
                key={v.id}
                className={v.id === selected?.id ? styles.selectedVersion : ""}
                disabled={saving}
                onClick={() => choose(v.id)}
              >
                <span>v{v.version}</span>
                <Status value={v.status} label={t[v.status]} />
              </button>
            ))}
            {!document?.versions.length && (
              <div className={styles.empty}>
                <strong>{t.empty}</strong>
                <p>{t.emptyHelp}</p>
              </div>
            )}
          </aside>
          <main className={styles.editor}>
            <div className={styles.editorToolbar}>
              <div>
                {selected && (
                  <>
                    <strong>v{selected.version}</strong>
                    <Status
                      value={selected.status}
                      label={t[selected.status]}
                    />
                  </>
                )}
              </div>
              <div>
                {selected && (
                  <button
                    disabled={session.admin.role === "viewer" || saving}
                    onClick={() =>
                      void command("clone", { sourceSurveyId: selected.id })
                    }
                  >
                    <Copy />
                    {t.clone}
                  </button>
                )}
                {editable && (
                  <button
                    disabled={saving}
                    onClick={() =>
                      void command("edit", {
                        surveyId: selected?.id,
                        expectedRevision: selected?.revision,
                        questions: normalize(questions),
                      })
                    }
                  >
                    <Save />
                    {t.save}
                  </button>
                )}
                {editable && (
                  <button
                    className={styles.primary}
                    disabled={saving}
                    onClick={() =>
                      window.confirm(t.confirmPublish) &&
                      void command("publish", {
                        surveyId: selected?.id,
                        expectedRevision: selected?.revision,
                      })
                    }
                  >
                    <Send />
                    {t.publish}
                  </button>
                )}
                {selected?.status === "published" &&
                  session.admin.role !== "viewer" && (
                    <button
                      disabled={saving}
                      onClick={() =>
                        window.confirm(t.confirmClose) &&
                        void command("close", { surveyId: selected.id })
                      }
                    >
                      <XCircle />
                      {t.close}
                    </button>
                  )}
                {selected &&
                  ["draft", "closed"].includes(selected.status) &&
                  session.admin.role !== "viewer" && (
                    <button
                      disabled={saving}
                      onClick={() =>
                        window.confirm(t.confirmArchive) &&
                        void command("archive", {
                          surveyId: selected.id,
                          expectedRevision: selected.revision,
                        })
                      }
                    >
                      {t.archive}
                    </button>
                  )}
              </div>
            </div>
            {message && (
              <p className={styles.message} role="status">
                {message}
              </p>
            )}
            {selected && (
              <div className={styles.questions}>
                {questions.map((q, index) => (
                  <QuestionEditor
                    key={q.clientId}
                    question={q}
                    index={index}
                    editable={editable}
                    locale={locale}
                    t={t}
                    onChange={(c) => update(index, c)}
                    onMove={(d) => move(index, d)}
                    onRemove={() =>
                      setQuestions((items) =>
                        items.filter((_, i) => i !== index),
                      )
                    }
                  />
                ))}
                {editable && questions.length < 6 && (
                  <button
                    className={styles.addQuestion}
                    onClick={() =>
                      setQuestions((items) => [
                        ...items,
                        {
                          clientId: crypto.randomUUID(),
                          type: "single_choice",
                          commonKey: null,
                          required: false,
                          position: items.length + 1,
                          text: { ko: "", en: "" },
                          options: [
                            { position: 1, label: { ko: "", en: "" } },
                            { position: 2, label: { ko: "", en: "" } },
                          ],
                        },
                      ])
                    }
                  >
                    <Plus />
                    {t.add}
                  </button>
                )}
              </div>
            )}
          </main>
          <aside className={styles.preview}>
            <div className={styles.sectionHead}>
              <h2>
                <Eye />
                {t.preview}
              </h2>
              <div className={styles.device}>
                <button
                  aria-pressed={device === "desktop"}
                  onClick={() => setDevice("desktop")}
                >
                  <Monitor />
                  <span>{t.desktop}</span>
                </button>
                <button
                  aria-pressed={device === "mobile"}
                  onClick={() => setDevice("mobile")}
                >
                  <Smartphone />
                  <span>{t.mobile}</span>
                </button>
              </div>
            </div>
            <div
              className={`${styles.previewFrame} ${device === "mobile" ? styles.mobilePreview : ""}`}
            >
              <h3>{locale === "ko" ? "라이브 후기" : "Live feedback"}</h3>
              {questions.map((q, i) => (
                <div key={q.clientId} className={styles.previewQuestion}>
                  <strong>
                    {i + 1}. {q.text[locale] || "—"}
                    {q.required && <em>*</em>}
                  </strong>
                  {q.type === "rating_1_5" ? (
                    <div className={styles.rating}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n}>{n}</span>
                      ))}
                    </div>
                  ) : q.type === "free_text" ? (
                    <textarea disabled rows={3} />
                  ) : (
                    <div>
                      {q.options.map((o) => (
                        <label key={o.position}>
                          <input
                            disabled
                            type={
                              q.type === "single_choice" ? "radio" : "checkbox"
                            }
                          />
                          {o.label[locale] || "—"}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </AdminOperationsShell>
  );
}
function Status({ value, label }: { value: string; label: string }) {
  return <span className={`${styles.status} ${styles[value]}`}>{label}</span>;
}
function QuestionEditor({
  question: q,
  index,
  editable,
  locale,
  t,
  onChange,
  onMove,
  onRemove,
}: {
  question: Question;
  index: number;
  editable: boolean;
  locale: AdminLocale;
  t: typeof copy.ko | typeof copy.en;
  onChange: (c: Partial<Question>) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const custom = q.commonKey === null;
  function changeOption(i: number, lang: "ko" | "en", value: string) {
    onChange({
      options: q.options.map((o, j) =>
        j === i ? { ...o, label: { ...o.label, [lang]: value } } : o,
      ),
    });
  }
  return (
    <fieldset className={styles.question} disabled={!editable}>
      <legend>
        <span>{index + 1}</span>
        {q.commonKey ?? (locale === "ko" ? "선택 질문" : "Custom question")}
      </legend>
      <div className={styles.questionActions}>
        <button
          type="button"
          aria-label="Move up"
          disabled={!editable || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={!editable}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </button>
        {custom && (
          <button type="button" aria-label={t.remove} onClick={onRemove}>
            <Trash2 />
          </button>
        )}
      </div>
      <div className={styles.row}>
        <label>
          {locale === "ko" ? "유형" : "Type"}
          <select
            disabled={!custom}
            value={q.type}
            onChange={(e) =>
              onChange({
                type: e.target.value as Question["type"],
                options: ["single_choice", "multiple_choice"].includes(
                  e.target.value,
                )
                  ? q.options.length
                    ? q.options
                    : [
                        { position: 1, label: { ko: "", en: "" } },
                        { position: 2, label: { ko: "", en: "" } },
                      ]
                  : [],
              })
            }
          >
            <option value="single_choice">Single</option>
            <option value="multiple_choice">Multiple</option>
            <option value="rating_1_5">Rating 1–5</option>
            <option value="free_text">Free text</option>
          </select>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            disabled={!custom}
            checked={q.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          {t.required}
        </label>
      </div>
      <label>
        {t.ko}
        <textarea
          value={q.text.ko}
          maxLength={1000}
          onChange={(e) =>
            onChange({ text: { ...q.text, ko: e.target.value } })
          }
        />
      </label>
      <label>
        {t.en}
        <textarea
          lang="en"
          value={q.text.en}
          maxLength={1000}
          onChange={(e) =>
            onChange({ text: { ...q.text, en: e.target.value } })
          }
        />
      </label>
      {["single_choice", "multiple_choice"].includes(q.type) && (
        <div className={styles.options}>
          <strong>{t.options}</strong>
          {q.options.map((o, i) => (
            <div key={i}>
              <input
                aria-label={`${t.ko} ${i + 1}`}
                value={o.label.ko}
                onChange={(e) => changeOption(i, "ko", e.target.value)}
              />
              <input
                aria-label={`${t.en} ${i + 1}`}
                lang="en"
                value={o.label.en}
                onChange={(e) => changeOption(i, "en", e.target.value)}
              />
              {editable && q.options.length > 2 && (
                <button
                  aria-label="Remove option"
                  onClick={() =>
                    onChange({ options: q.options.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 />
                </button>
              )}
            </div>
          ))}
          {editable && q.options.length < 20 && (
            <button
              onClick={() =>
                onChange({
                  options: [
                    ...q.options,
                    {
                      position: q.options.length + 1,
                      label: { ko: "", en: "" },
                    },
                  ],
                })
              }
            >
              <Plus /> Option
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
