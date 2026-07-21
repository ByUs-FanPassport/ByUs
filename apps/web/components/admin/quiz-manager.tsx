"use client";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./admin.module.css";
type Option = {
  position: number;
  labelKo: string;
  labelEn: string;
  isCorrect: boolean;
  active: boolean;
};
type Question = {
  id?: string;
  position: number;
  promptKo: string;
  promptEn: string;
  active: boolean;
  options: Option[];
};
type Quiz = {
  id: string;
  version: number;
  status: "draft" | "published";
  questions: Question[];
  publishedAt: string | null;
  everPublishedAt: string | null;
  retiredAt: string | null;
};
const newQuestion = (position: number): Question => ({
  position,
  promptKo: "",
  promptEn: "",
  active: true,
  options: [1, 2, 3, 4].map((n) => ({
    position: n,
    labelKo: "",
    labelEn: "",
    isCorrect: n === 1,
    active: true,
  })),
});
export function QuizManager({ celebrityId }: { celebrityId: string }) {
  const session = useAdminSession(),
    { getAccessToken } = usePrivy(),
    [locale, setLocale] = useState<AdminLocale>("ko"),
    [items, setItems] = useState<Quiz[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [questions, setQuestions] = useState<Question[]>([]),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true);
  const canEdit =
    session.status === "authorized" && session.admin.role !== "viewer";
  const req = useCallback(
    async (method: string, body?: unknown) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");
      const r = await fetch(`/api/admin/celebrities/${celebrityId}/quiz`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.message || p.error);
      return p;
    },
    [celebrityId, getAccessToken],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = (await req("GET")) as { items: Quiz[] };
      setItems(p.items);
      const chosen = p.items.find((x) => x.id === selected) || p.items[0];
      setSelected(chosen?.id || null);
      setQuestions(
        chosen?.questions || [newQuestion(1), newQuestion(2), newQuestion(3)],
      );
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [req, selected]);
  useEffect(() => {
    if (session.status === "authorized") void load();
  }, [session.status, load]);
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  const quiz = items.find((x) => x.id === selected),
    editable = !quiz || (quiz.status === "draft" && !quiz.everPublishedAt);
  async function command(body: unknown) {
    try {
      await req("POST", body);
      await load();
      setMessage(locale === "ko" ? "저장했습니다." : "Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error");
    }
  }
  function move(index: number, delta: number) {
    const next = [...questions],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setQuestions(next.map((q, i) => ({ ...q, position: i + 1 })));
  }
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.cmsHeading}>
        <div>
          <Link href="/admin/celebrities" className={styles.backLink}>
            <ArrowLeft aria-hidden="true" />
            {locale === "ko" ? "셀럽 목록" : "Celebrities"}
          </Link>
          <h1>{locale === "ko" ? "팬 퀴즈" : "Fan quiz"}</h1>
          <span>
            {locale === "ko"
              ? "발행된 버전은 보존되며 수정 시 새 버전을 만듭니다."
              : "Published versions stay immutable; clone to edit."}
          </span>
        </div>
        <div className={styles.cmsLocale}>
          <button
            onClick={() => setLocale("ko")}
            aria-pressed={locale === "ko"}
          >
            KO
          </button>
          <button
            onClick={() => setLocale("en")}
            aria-pressed={locale === "en"}
          >
            EN
          </button>
        </div>
      </div>
      <div className={styles.quizVersionBar}>
        {items.map((x) => (
          <button
            key={x.id}
            className={selected === x.id ? styles.cmsTabActive : ""}
            onClick={() => {
              setSelected(x.id);
              setQuestions(x.questions);
            }}
          >
            v{x.version} · {x.retiredAt ? "retired" : x.status}
          </button>
        ))}
        {canEdit && (
          <button
            onClick={() => {
              setSelected(null);
              setQuestions([newQuestion(1), newQuestion(2), newQuestion(3)]);
            }}
          >
            <Plus aria-hidden="true" />{" "}
            {locale === "ko" ? "새 버전" : "New version"}
          </button>
        )}
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className={styles.quizQuestions}>
          {questions.map((q, index) => (
            <fieldset
              key={q.id || index}
              disabled={!canEdit || !editable}
              className={styles.quizQuestion}
            >
              <legend>
                <span>Q{index + 1}</span>
                <label>
                  <input
                    type="checkbox"
                    checked={q.active}
                    onChange={(e) =>
                      setQuestions((a) =>
                        a.map((v, i) =>
                          i === index ? { ...v, active: e.target.checked } : v,
                        ),
                      )
                    }
                  />
                  {locale === "ko" ? "활성" : "Active"}
                </label>
                <button
                  type="button"
                  aria-label="Move up"
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </button>
              </legend>
              <label>
                <span>
                  {locale === "ko" ? "질문 (한국어)" : "Question (Korean)"}
                </span>
                <input
                  value={q.promptKo}
                  onChange={(e) =>
                    setQuestions((a) =>
                      a.map((v, i) =>
                        i === index ? { ...v, promptKo: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span>Question (English)</span>
                <input
                  lang="en"
                  value={q.promptEn}
                  onChange={(e) =>
                    setQuestions((a) =>
                      a.map((v, i) =>
                        i === index ? { ...v, promptEn: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <div className={styles.quizOptions}>
                {q.options.map((o, oi) => (
                  <div key={oi}>
                    <input
                      type="radio"
                      name={`correct-${index}`}
                      aria-label={`${oi + 1} correct`}
                      checked={o.isCorrect}
                      onChange={() =>
                        setQuestions((a) =>
                          a.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  options: v.options.map((x, j) => ({
                                    ...x,
                                    isCorrect: j === oi,
                                  })),
                                }
                              : v,
                          ),
                        )
                      }
                    />
                    <label className={styles.quizOptionActive}>
                      <input
                        type="checkbox"
                        checked={o.active}
                        onChange={(e) =>
                          setQuestions((a) =>
                            a.map((v, i) =>
                              i === index
                                ? {
                                    ...v,
                                    options: v.options.map((x, j) =>
                                      j === oi
                                        ? { ...x, active: e.target.checked }
                                        : x,
                                    ),
                                  }
                                : v,
                            ),
                          )
                        }
                      />
                      <span>{locale === "ko" ? "사용" : "Active"}</span>
                    </label>
                    <input
                      aria-label={`Option ${oi + 1} Korean`}
                      placeholder={`${oi + 1}. 한국어`}
                      value={o.labelKo}
                      onChange={(e) =>
                        setQuestions((a) =>
                          a.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  options: v.options.map((x, j) =>
                                    j === oi
                                      ? { ...x, labelKo: e.target.value }
                                      : x,
                                  ),
                                }
                              : v,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`Option ${oi + 1} English`}
                      placeholder={`${oi + 1}. English`}
                      value={o.labelEn}
                      onChange={(e) =>
                        setQuestions((a) =>
                          a.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  options: v.options.map((x, j) =>
                                    j === oi
                                      ? { ...x, labelEn: e.target.value }
                                      : x,
                                  ),
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          {canEdit && editable && (
            <button
              className={styles.quizAdd}
              onClick={() =>
                setQuestions((a) => [...a, newQuestion(a.length + 1)])
              }
            >
              <Plus aria-hidden="true" />
              {locale === "ko" ? "문항 추가" : "Add question"}
            </button>
          )}
        </div>
      )}
      {message && (
        <p className={styles.cmsMessage} role="status">
          {message}
        </p>
      )}
      <div className={styles.formActions}>
        {quiz?.everPublishedAt && canEdit && (
          <button
            className={styles.secondaryButton}
            onClick={() => void command({ action: "clone", quizId: quiz.id })}
          >
            <Copy aria-hidden="true" />
            {locale === "ko" ? "새 버전으로 복제" : "Clone new version"}
          </button>
        )}
        {canEdit && editable && (
          <>
            <button
              className={styles.secondaryButton}
              onClick={() =>
                void command({
                  action: "save",
                  payload: { quizId: selected, questions },
                })
              }
            >
              <Save aria-hidden="true" />
              {locale === "ko" ? "초안 저장" : "Save draft"}
            </button>
            {quiz && (
              <button
                className={styles.cmsPrimary}
                onClick={() =>
                  void command({ action: "publish", quizId: quiz.id })
                }
              >
                {locale === "ko" ? "이 버전 발행" : "Publish version"}
              </button>
            )}
          </>
        )}
      </div>
    </AdminOperationsShell>
  );
}
