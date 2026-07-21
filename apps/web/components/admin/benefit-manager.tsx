"use client";
import { usePrivy } from "@privy-io/react-auth";
import { Archive, Gift, Plus, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./benefit-manager.module.css";
type Loc = {
  title: string;
  summary: string;
  eligibilityLabel: string;
  deliveryLabel: string;
};
type App = {
  id: string;
  appUserId: string;
  status: string;
  submittedAt: string;
  claimId: string | null;
};
type Claim = {
  id: string;
  appUserId: string;
  claimedAt: string;
  usedAt: string | null;
};
type Benefit = {
  id: string;
  slug: string;
  celebrityId: string;
  publicationStatus: "draft" | "published";
  allocationMode: "direct_claim" | "application_selection";
  deliveryType: string;
  claimOpensAt: string;
  claimClosesAt: string;
  stockLimit: number | null;
  perUserLimit: number;
  minimumScore: number;
  minimumLevel: string;
  requiredStampType: string | null;
  requiredActivityType: string | null;
  archivedAt: string | null;
  revision: number;
  deliveryConfigured: boolean;
  codeInventory: { total: number; available: number };
  localizations: { ko: Loc; en: Loc };
  applications: App[];
  claims: Claim[];
};
type Data = {
  benefits: Benefit[];
  celebrities: Array<{
    id: string;
    nameKo: string;
    nameEn: string;
    status: string;
  }>;
};
type Form = {
  id: string;
  revision: number;
  slug: string;
  celebrityId: string;
  allocationMode: "direct_claim" | "application_selection";
  deliveryType: string;
  claimOpensAt: string;
  claimClosesAt: string;
  stockLimit: string;
  perUserLimit: string;
  minimumScore: string;
  minimumLevel: string;
  requiredStampType: string;
  requiredActivityType: string;
  deliverySecret: string;
  titleKo: string;
  summaryKo: string;
  eligibilityKo: string;
  deliveryKo: string;
  titleEn: string;
  summaryEn: string;
  eligibilityEn: string;
  deliveryEn: string;
};
const blank: Form = {
  id: "",
  revision: 1,
  slug: "",
  celebrityId: "",
  allocationMode: "direct_claim",
  deliveryType: "text",
  claimOpensAt: "",
  claimClosesAt: "",
  stockLimit: "",
  perUserLimit: "1",
  minimumScore: "0",
  minimumLevel: "Bronze",
  requiredStampType: "",
  requiredActivityType: "",
  deliverySecret: "",
  titleKo: "",
  summaryKo: "",
  eligibilityKo: "",
  deliveryKo: "",
  titleEn: "",
  summaryEn: "",
  eligibilityEn: "",
  deliveryEn: "",
};
const copy = {
  ko: {
    title: "혜택 관리",
    desc: "혜택의 공개 조건, 재고, 전달과 선정을 안전하게 운영합니다.",
    new: "새 혜택",
    list: "혜택 목록",
    save: "초안 저장",
    publish: "발행",
    unpublish: "발행 취소",
    archive: "보관",
    codes: "코드 등록",
    clearCodes: "코드 전체 삭제",
    apps: "신청 및 선정",
    claims: "수령 및 사용 이력",
    select: "선정",
    reject: "미선정",
    used: "사용 처리",
    readonly: "Viewer 권한은 조회만 가능합니다.",
    secret:
      "전달값과 코드는 저장 후 화면, 응답, 감사 로그에 다시 표시되지 않습니다.",
    failure: "혜택 데이터를 처리하지 못했습니다.",
    confirm: "이 작업은 이력에 영구 기록되며 되돌릴 수 없습니다. 계속할까요?",
  },
  en: {
    title: "Benefit manager",
    desc: "Operate benefit eligibility, inventory, delivery, and selection safely.",
    new: "New benefit",
    list: "Benefits",
    save: "Save draft",
    publish: "Publish",
    unpublish: "Unpublish",
    archive: "Archive",
    codes: "Upload codes",
    clearCodes: "Clear all codes",
    apps: "Applications and selection",
    claims: "Claims and usage",
    select: "Select",
    reject: "Not selected",
    used: "Mark used",
    readonly: "Viewer access is read-only.",
    secret:
      "Delivery values and codes are never shown again in screens, responses, or audit logs.",
    failure: "Benefit data could not be processed.",
    confirm:
      "This action is permanently recorded and cannot be undone. Continue?",
  },
} as const;
const local = (v: string) => (v ? new Date(v).toISOString().slice(0, 16) : "");
const instant = (v: string) => new Date(`${v}:00Z`).toISOString();
function formFor(b: Benefit): Form {
  return {
    id: b.id,
    revision: b.revision,
    slug: b.slug,
    celebrityId: b.celebrityId,
    allocationMode: b.allocationMode,
    deliveryType: b.deliveryType,
    claimOpensAt: local(b.claimOpensAt),
    claimClosesAt: local(b.claimClosesAt),
    stockLimit: b.stockLimit?.toString() ?? "",
    perUserLimit: String(b.perUserLimit),
    minimumScore: String(b.minimumScore),
    minimumLevel: b.minimumLevel,
    requiredStampType: b.requiredStampType ?? "",
    requiredActivityType: b.requiredActivityType ?? "",
    deliverySecret: "",
    titleKo: b.localizations.ko.title,
    summaryKo: b.localizations.ko.summary,
    eligibilityKo: b.localizations.ko.eligibilityLabel,
    deliveryKo: b.localizations.ko.deliveryLabel,
    titleEn: b.localizations.en.title,
    summaryEn: b.localizations.en.summary,
    eligibilityEn: b.localizations.en.eligibilityLabel,
    deliveryEn: b.localizations.en.deliveryLabel,
  };
}
export function AuthorizedBenefitManager() {
  const locale: AdminLocale =
      useSearchParams().get("lang") === "en" ? "en" : "ko",
    s = useAdminSession();
  if (s.status !== "authorized")
    return <AdminAccessState locale={locale} status={s.status} />;
  return <BenefitManager locale={locale} role={s.admin.role} />;
}
function BenefitManager({
  locale,
  role,
}: {
  locale: AdminLocale;
  role: string;
}) {
  const { getAccessToken } = usePrivy(),
    t = copy[locale],
    canWrite = role !== "viewer";
  const [data, setData] = useState<Data | null>(null),
    [form, setForm] = useState(blank),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [codes, setCodes] = useState("");
  const selected = data?.benefits.find((b) => b.id === form.id);
  const request = useCallback(
    async (body?: unknown) => {
      const token = await getAccessToken();
      if (!token) throw new Error("auth");
      const r = await fetch("/api/admin/benefits", {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    [getAccessToken],
  );
  const refresh = useCallback(async () => {
    try {
      setData((await request()) as Data);
      setError("");
    } catch {
      setCodes("");
      setError(t.failure);
    }
  }, [request, t.failure]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  function choose(next: Form) {
    setCodes("");
    setError("");
    setForm(next);
  }
  function set(k: keyof Form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  async function cmd(body: unknown) {
    if (pending) return;
    setForm((current) => ({ ...current, deliverySecret: "" }));
    try {
      setPending(true);
      setError("");
      await request(body);
      setCodes("");
      await refresh();
    } catch {
      setCodes("");
      setError(t.failure);
    } finally {
      setPending(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await cmd({
      action: "save",
      ...form,
      id: form.id || null,
      expectedRevision: form.id ? form.revision : null,
      claimOpensAt: instant(form.claimOpensAt),
      claimClosesAt: instant(form.claimClosesAt),
      stockLimit: form.stockLimit ? Number(form.stockLimit) : null,
      perUserLimit: Number(form.perUserLimit),
      minimumScore: Number(form.minimumScore),
      requiredStampType: form.requiredStampType || null,
      requiredActivityType: form.requiredActivityType || null,
    });
  }
  async function archive() {
    if (
      selected &&
      window.confirm(`${t.archive}: ${selected.localizations[locale].title}`)
    ) {
      const reason = window.prompt(t.archive);
      if (reason)
        await cmd({
          action: "archive",
          id: selected.id,
          expectedRevision: selected.revision,
          reason,
        });
    }
  }
  return (
    <AdminOperationsShell locale={locale}>
      <div className={styles.heading}>
        <div>
          <p>ADM-007</p>
          <h1>{t.title}</h1>
          <span>{t.desc}</span>
        </div>
        <button
          type="button"
          disabled={!canWrite || pending}
          onClick={() => choose(blank)}
        >
          <Plus aria-hidden="true" />
          {t.new}
        </button>
      </div>
      {!canWrite && <p className={styles.notice}>{t.readonly}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <div className={styles.skeleton} aria-busy="true" />
      ) : (
        <div className={styles.layout}>
          <section className={styles.list}>
            <h2>
              {t.list} · {data.benefits.length}
            </h2>
            <ul>
              {data.benefits.map((b) => (
                <li key={b.id}>
                  <button
                    data-selected={b.id === form.id}
                    onClick={() => choose(formFor(b))}
                  >
                    <span>
                      <strong>{b.localizations[locale].title}</strong>
                      <small>{b.slug}</small>
                    </span>
                    <i>{b.archivedAt ? "archived" : b.publicationStatus}</i>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.editor} aria-busy={pending}>
            <form onSubmit={submit}>
              <fieldset
                disabled={
                  !canWrite ||
                  pending ||
                  Boolean(selected?.archivedAt) ||
                  selected?.publicationStatus === "published"
                }
              >
                <legend>
                  <Gift aria-hidden="true" /> Configuration
                </legend>
                <div className={styles.grid}>
                  <Field
                    label="Slug"
                    value={form.slug}
                    set={(v) => set("slug", v)}
                  />
                  <Select
                    label="Celebrity"
                    value={form.celebrityId}
                    set={(v) => set("celebrityId", v)}
                    options={data.celebrities.map((c) => [
                      c.id,
                      locale === "ko" ? c.nameKo : c.nameEn,
                    ])}
                  />
                  <Select
                    label="Allocation"
                    value={form.allocationMode}
                    set={(v) => {
                      set("allocationMode", v);
                      if (v === "application_selection")
                        set("perUserLimit", "1");
                    }}
                    options={[
                      ["direct_claim", "Direct claim"],
                      ["application_selection", "Application selection"],
                    ]}
                  />
                  <Select
                    label="Delivery"
                    value={form.deliveryType}
                    set={(v) => set("deliveryType", v)}
                    options={[
                      "text",
                      "external_link",
                      "shared_code",
                      "unique_code",
                    ].map((v) => [v, v])}
                  />
                  <Field
                    type="datetime-local"
                    label="Opens (UTC)"
                    value={form.claimOpensAt}
                    set={(v) => set("claimOpensAt", v)}
                  />
                  <Field
                    type="datetime-local"
                    label="Closes (UTC)"
                    value={form.claimClosesAt}
                    set={(v) => set("claimClosesAt", v)}
                  />
                  <Field
                    type="number"
                    label="Stock (blank = unlimited)"
                    value={form.stockLimit}
                    set={(v) => set("stockLimit", v)}
                  />
                  <Field
                    type="number"
                    label="Per user"
                    value={form.perUserLimit}
                    set={(v) => set("perUserLimit", v)}
                  />
                  <Field
                    type="number"
                    label="Minimum score"
                    value={form.minimumScore}
                    set={(v) => set("minimumScore", v)}
                  />
                  <Select
                    label="Minimum level"
                    value={form.minimumLevel}
                    set={(v) => set("minimumLevel", v)}
                    options={[
                      "Bronze",
                      "Silver",
                      "Gold",
                      "Platinum",
                      "Diamond",
                    ].map((v) => [v, v])}
                  />
                  <Select
                    label="Required stamp"
                    value={form.requiredStampType}
                    set={(v) => set("requiredStampType", v)}
                    options={[
                      ["", "None"],
                      ...[
                        "knowledge",
                        "reservation",
                        "attendance",
                        "survey",
                      ].map((v) => [v, v]),
                    ]}
                  />
                  <Select
                    label="Required activity"
                    value={form.requiredActivityType}
                    set={(v) => set("requiredActivityType", v)}
                    options={[
                      ["", "None"],
                      ...[
                        "knowledge",
                        "reservation",
                        "attendance",
                        "survey",
                      ].map((v) => [v, v]),
                    ]}
                  />
                  {form.deliveryType !== "unique_code" && (
                    <Field
                      type="password"
                      label="Private delivery value"
                      value={form.deliverySecret}
                      set={(v) => set("deliverySecret", v)}
                    />
                  )}
                </div>
                <p className={styles.security}>{t.secret}</p>
              </fieldset>
              <fieldset
                disabled={
                  !canWrite ||
                  pending ||
                  Boolean(selected?.archivedAt) ||
                  selected?.publicationStatus === "published"
                }
              >
                <legend>한국어 · English</legend>
                <div className={styles.localeGrid}>
                  <Locale lang="한국어" form={form} suffix="Ko" set={set} />
                  <Locale lang="English" form={form} suffix="En" set={set} />
                </div>
              </fieldset>
              <div className={styles.actions}>
                <button
                  type="submit"
                  disabled={
                    !canWrite ||
                    pending ||
                    Boolean(selected?.archivedAt) ||
                    selected?.publicationStatus === "published"
                  }
                >
                  <Save aria-hidden="true" />
                  {t.save}
                </button>
                {selected && !selected.archivedAt && (
                  <>
                    <button
                      type="button"
                      disabled={!canWrite || pending}
                      onClick={() =>
                        void cmd({
                          action:
                            selected.publicationStatus === "published"
                              ? "unpublish"
                              : "publish",
                          id: selected.id,
                          expectedRevision: selected.revision,
                        })
                      }
                    >
                      {selected.publicationStatus === "published"
                        ? t.unpublish
                        : t.publish}
                    </button>
                    <button
                      className={styles.danger}
                      type="button"
                      disabled={!canWrite || pending}
                      onClick={() => void archive()}
                    >
                      <Archive aria-hidden="true" />
                      {t.archive}
                    </button>
                  </>
                )}
              </div>
            </form>
            {selected?.deliveryType === "unique_code" &&
              !selected.archivedAt &&
              selected.publicationStatus === "draft" && (
                <section className={styles.inventory}>
                  <h2>
                    {t.codes} · {selected.codeInventory.available}/
                    {selected.codeInventory.total}
                  </h2>
                  <textarea
                    value={codes}
                    onChange={(e) => setCodes(e.target.value)}
                    aria-label={t.codes}
                  />
                  <span className={styles.decision}>
                    <button
                      disabled={!canWrite || pending || !codes.trim()}
                      onClick={() =>
                        void cmd({
                        action: "codes",
                        id: selected.id,
                        expectedRevision: selected.revision,
                        codes: codes.split(/\r?\n/).filter(Boolean),
                        })
                      }
                    >
                      {t.codes}
                    </button>
                    <button
                      disabled={
                        !canWrite ||
                        pending ||
                        selected.codeInventory.total === 0
                      }
                      onClick={() => {
                        if (window.confirm(t.confirm))
                          void cmd({
                            action: "clear_codes",
                            id: selected.id,
                            expectedRevision: selected.revision,
                          });
                      }}
                    >
                      {t.clearCodes}
                    </button>
                  </span>
                </section>
              )}
            {selected?.allocationMode === "application_selection" && (
              <History title={t.apps}>
                {selected.applications.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.appUserId}
                      <small>{a.status}</small>
                    </span>
                    {a.status === "submitted" && (
                      <span className={styles.decision}>
                        <button
                          disabled={!canWrite || pending}
                          onClick={() => {
                            if (window.confirm(t.confirm))
                              void cmd({
                                action: "decide",
                                applicationId: a.id,
                                selected: true,
                                idempotencyKey: crypto.randomUUID(),
                              });
                          }}
                        >
                          {t.select}
                        </button>
                        <button
                          disabled={!canWrite || pending}
                          onClick={() => {
                            if (window.confirm(t.confirm))
                              void cmd({
                                action: "decide",
                                applicationId: a.id,
                                selected: false,
                                idempotencyKey: crypto.randomUUID(),
                              });
                          }}
                        >
                          {t.reject}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </History>
            )}
            {selected && (
              <History title={t.claims}>
                {selected.claims.map((c) => (
                  <li key={c.id}>
                    <span>
                      {c.appUserId}
                      <small>{c.usedAt ?? c.claimedAt}</small>
                    </span>
                    {!c.usedAt && (
                      <button
                        className={styles.use}
                        disabled={!canWrite || pending}
                        onClick={() => {
                          if (window.confirm(t.confirm))
                            void cmd({
                              action: "use",
                              claimId: c.id,
                              usedAt: new Date().toISOString(),
                            });
                        }}
                      >
                        {t.used}
                      </button>
                    )}
                  </li>
                ))}
              </History>
            )}
          </section>
        </div>
      )}
    </AdminOperationsShell>
  );
}
function Field({
  label,
  value,
  set,
  type = "text",
}: {
  label: string;
  value: string;
  set(v: string): void;
  type?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        required={!label.includes("blank") && !label.includes("Private")}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function Select({
  label,
  value,
  set,
  options,
}: {
  label: string;
  value: string;
  set(v: string): void;
  options: string[][];
}) {
  return (
    <label>
      <span>{label}</span>
      <select required value={value} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o[0]} value={o[0]}>
            {o[1]}
          </option>
        ))}
      </select>
    </label>
  );
}
function Locale({
  lang,
  form,
  suffix,
  set,
}: {
  lang: string;
  form: Form;
  suffix: "Ko" | "En";
  set(k: keyof Form, v: string): void;
}) {
  return (
    <div>
      <h3>{lang}</h3>
      {(["title", "summary", "eligibility", "delivery"] as const).map((k) => (
        <Field
          key={k}
          label={k}
          value={form[`${k}${suffix}` as keyof Form] as string}
          set={(v) => set(`${k}${suffix}` as keyof Form, v)}
        />
      ))}
    </div>
  );
}
function History({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.history}>
      <h2>{title}</h2>
      <ul className={styles.rows}>{children}</ul>
    </section>
  );
}
