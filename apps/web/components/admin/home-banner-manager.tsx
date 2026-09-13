"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowDown, ArrowUp, ImagePlus, Plus, RefreshCw, Save, Send, Undo2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  bannerPublicationIssues,
  homeBannerManagerDataSchema,
  type AdminHomeBanner,
  type BannerLocalization,
  type HomeBannerCommand,
  type HomeBannerManagerData,
} from "../../features/home/domain/home-banner";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./home-banner-manager.module.css";

type Asset = BannerLocalization["desktopImage"];
type DraftLocalization = BannerLocalization;
type Draft = Omit<AdminHomeBanner, "id"> & { id: string };
type ImageField = "desktopImage" | "mobileImage";
type SaveCommand = Extract<HomeBannerCommand, { action: "save" }>;

const emptyLocalization = (): DraftLocalization => ({
  title: "", description: "", ctaLabel: "", href: "", alt: "", desktopImage: null, mobileImage: null,
});
const emptyDraft = (): Draft => ({
  id: "", kind: "regular_live", celebrityId: null, publicationStatus: "draft", sortOrder: 0, revision: 0,
  localizations: { ko: emptyLocalization(), en: emptyLocalization() },
});
const cloneDraft = (banner: AdminHomeBanner): Draft => structuredClone(banner);

const copy = {
  ko: {
    title: "홈 배너 관리", description: "캘린더 일정과 별도로 홈 상단 대형 배너를 등록하고 공개 순서를 관리합니다.",
    new: "새 배너", list: "배너 목록", empty: "등록된 배너가 없습니다.", regular: "정기 방송", announcement: "안내",
    creator: "크리에이터", chooseCreator: "크리에이터 선택", kind: "배너 종류", draft: "비공개", published: "공개",
    save: "초안 저장", saveChanges: "변경사항 저장", publish: "공개", unpublish: "비공개로 전환", up: "위로", down: "아래로",
    readonly: "Viewer 권한은 조회만 가능합니다.", ko: "한국어", en: "English", titleField: "제목", descriptionField: "설명",
    cta: "버튼 문구", href: "이동 링크", alt: "이미지 대체 텍스트", desktop: "데스크톱 이미지", mobile: "모바일 이미지 (선택 · 없으면 데스크톱 이미지 사용)",
    upload: "이미지 업로드", remove: "이미지 제거", noImage: "등록된 이미지 없음", saved: "배너를 저장했습니다.",
    reordered: "배너 순서를 변경했습니다.", publicationChanged: "공개 상태를 변경했습니다.", failure: "배너 데이터를 처리하지 못했습니다.",
    uploadFailure: "이미지를 등록하지 못했습니다.", invalid: "저장할 수 없습니다. 셀럽별로 공개할 수 있는 정기 방송 배너는 최대 1개이며 입력 항목도 확인해 주세요.", issues: "공개 전에 다음 항목을 입력해 주세요.",
    conflict: "다른 관리자가 먼저 변경했습니다. 현재 입력은 보존했습니다. 서버 데이터를 다시 불러오면 현재 입력이 사라집니다.", reload: "서버 데이터 다시 불러오기",
  },
  en: {
    title: "Home banner manager", description: "Manage the large home hero banners independently from calendar events.",
    new: "New banner", list: "Banners", empty: "No banners have been added.", regular: "Regular LIVE", announcement: "Announcement",
    creator: "Creator", chooseCreator: "Select a creator", kind: "Banner type", draft: "Hidden", published: "Published",
    save: "Save draft", saveChanges: "Save changes", publish: "Publish", unpublish: "Unpublish", up: "Move up", down: "Move down",
    readonly: "Viewer access is read-only.", ko: "한국어", en: "English", titleField: "Title", descriptionField: "Description",
    cta: "Button label", href: "Destination link", alt: "Image alternative text", desktop: "Desktop image", mobile: "Mobile image (optional · desktop image is used when empty)",
    upload: "Upload image", remove: "Remove image", noImage: "No image selected", saved: "Banner saved.",
    reordered: "Banner order updated.", publicationChanged: "Publication status updated.", failure: "Banner data could not be processed.",
    uploadFailure: "The image could not be uploaded.", invalid: "The banner could not be saved. Each creator can have at most one published regular LIVE banner; check the entered fields as well.", issues: "Complete these fields before publishing.",
    conflict: "Another administrator updated this data first. Your input is preserved. Reloading will replace your current input.", reload: "Reload server data",
  },
} as const;

const issueLabels = (locale: AdminLocale) => {
  const t = copy[locale];
  return {
    celebrityId: t.creator,
    "ko.title": `${t.ko} · ${t.titleField}`, "ko.ctaLabel": `${t.ko} · ${t.cta}`, "ko.href": `${t.ko} · ${t.href}`,
    "ko.alt": `${t.ko} · ${t.alt}`, "ko.desktopImage": `${t.ko} · ${t.desktop}`,
    "en.title": `${t.en} · ${t.titleField}`, "en.ctaLabel": `${t.en} · ${t.cta}`, "en.href": `${t.en} · ${t.href}`,
    "en.alt": `${t.en} · ${t.alt}`, "en.desktopImage": `${t.en} · ${t.desktop}`,
  } as Record<string, string>;
};

export function AuthorizedHomeBannerManager() {
  const locale: AdminLocale = useSearchParams().get("lang") === "en" ? "en" : "ko";
  const session = useAdminSession();
  if (session.status !== "authorized") return <AdminAccessState locale={locale} status={session.status} />;
  return <HomeBannerManager key={session.admin.email} locale={locale} role={session.admin.role} />;
}

export function HomeBannerManager({ locale, role }: { locale: AdminLocale; role: string }) {
  const { getAccessToken } = usePrivy();
  const t = copy[locale];
  const canWrite = role !== "viewer";
  const [data, setData] = useState<HomeBannerManagerData | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [attemptedPublish, setAttemptedPublish] = useState(false);
  const busy = pending || !!uploading;
  const issues = useMemo(() => bannerPublicationIssues(draft), [draft]);
  const issueSet = useMemo(() => new Set(issues), [issues]);
  const labels = issueLabels(locale);

  const authorizedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const token = await getAccessToken();
    if (!token) throw new Error("auth");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-correlation-id", crypto.randomUUID());
    return fetch(input, { ...init, headers, cache: "no-store" });
  }, [getAccessToken]);

  const load = useCallback(async () => {
    setPending(true); setError("");
    try {
      const response = await authorizedFetch("/api/admin/home-banners");
      if (!response.ok) throw new Error(String(response.status));
      const next = homeBannerManagerDataSchema.parse(await response.json());
      setData(next);
      setDraft(next.items[0] ? cloneDraft(next.items[0]) : emptyDraft());
      setConflict(false); setAttemptedPublish(false); setMessage("");
    } catch { setError(t.failure); }
    finally { setPending(false); }
  }, [authorizedFetch, t.failure]);

  useEffect(() => { void load(); }, [load]);

  async function command(body: HomeBannerCommand): Promise<HomeBannerManagerData | null> {
    setPending(true); setError(""); setMessage("");
    try {
      const response = await authorizedFetch("/api/admin/home-banners", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.status === 409) {
        const payload = await response.json().catch(() => null) as { error?: string | { code?: string } } | null;
        const code = typeof payload?.error === "string" ? payload.error : payload?.error?.code;
        if (code === "REVISION_CONFLICT" || code === "CONFLICT") setConflict(true);
        else setError(t.invalid);
        return null;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = homeBannerManagerDataSchema.parse(await response.json());
      setData(next); setConflict(false);
      return next;
    } catch { setError(t.failure); return null; }
    finally { setPending(false); }
  }

  function saveCommand(value: Draft): HomeBannerCommand {
    const localizations = Object.fromEntries((["ko", "en"] as const).map((language) => {
      const item = value.localizations[language];
      return [language, {
        title: item.title, description: item.description, ctaLabel: item.ctaLabel, href: item.href, alt: item.alt,
        desktopAssetId: item.desktopImage?.id ?? null, mobileAssetId: item.mobileImage?.id ?? null,
      }];
    })) as SaveCommand["localizations"];
    return { action: "save", id: value.id || null, expectedRevision: value.revision, kind: value.kind, celebrityId: value.celebrityId, localizations };
  }

  async function save() {
    if (!canWrite || busy) return;
    const previousIds = new Set(data?.items.map((item) => item.id));
    const next = await command(saveCommand(draft));
    if (!next) return;
    const saved = draft.id ? next.items.find((item) => item.id === draft.id) : next.items.find((item) => !previousIds.has(item.id));
    if (saved) setDraft(cloneDraft(saved));
    setAttemptedPublish(false); setMessage(t.saved);
  }

  async function changePublication(publicationStatus: "draft" | "published") {
    if (!canWrite || busy || !draft.id) return;
    if (publicationStatus === "published" && issues.length) { setAttemptedPublish(true); return; }
    let revision = draft.revision;
    if (publicationStatus === "published") {
      const saved = await command(saveCommand(draft));
      const savedBanner = saved?.items.find((item) => item.id === draft.id);
      if (!savedBanner) return;
      setDraft(cloneDraft(savedBanner));
      revision = savedBanner.revision;
    }
    const next = await command({ action: "publication", id: draft.id, expectedRevision: revision, publicationStatus });
    const updated = next?.items.find((item) => item.id === draft.id);
    if (updated) setDraft(cloneDraft(updated));
    if (next) { setAttemptedPublish(false); setMessage(t.publicationChanged); }
  }

  async function reorder(direction: -1 | 1) {
    if (!canWrite || busy || !draft.id || !data) return;
    const index = data.items.findIndex((item) => item.id === draft.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.items.length) return;
    const ordered = [...data.items];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const next = await command({ action: "reorder", items: ordered.map(({ id, revision }) => ({ id, expectedRevision: revision })) });
    const updated = next?.items.find((item) => item.id === draft.id);
    if (updated) setDraft((current) => current.id === updated.id ? {
      ...current, revision: updated.revision, sortOrder: updated.sortOrder, publicationStatus: updated.publicationStatus,
    } : current);
    if (next) setMessage(t.reordered);
  }

  function updateRoot(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch })); setMessage(""); }
  function updateLocalization(language: "ko" | "en", patch: Partial<DraftLocalization>) {
    setDraft((current) => ({ ...current, localizations: { ...current.localizations, [language]: { ...current.localizations[language], ...patch } } }));
    setMessage("");
  }

  async function upload(language: "ko" | "en", field: ImageField, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canWrite) return;
    const key = `${language}.${field}`;
    setUploading(key); setError(""); setMessage("");
    try {
      const body = new FormData(); body.set("file", file);
      const response = await authorizedFetch("/api/admin/image-assets", { method: "POST", body });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { asset: Exclude<Asset, null> };
      updateLocalization(language, { [field]: payload.asset });
    } catch { setError(t.uploadFailure); }
    finally { setUploading(""); }
  }

  const index = data?.items.findIndex((item) => item.id === draft.id) ?? -1;
  return (
    <AdminOperationsShell locale={locale} adminRole={role}>
      <section className={styles.page} aria-labelledby="home-banner-heading">
        <header className={styles.header}>
          <div><h1 id="home-banner-heading">{t.title}</h1><p>{t.description}</p></div>
          <button className={styles.button} type="button" disabled={!canWrite || busy} onClick={() => { setDraft(emptyDraft()); setAttemptedPublish(false); setMessage(""); setError(""); }}><Plus aria-hidden="true" />{t.new}</button>
        </header>
        {!canWrite && <p className={styles.readonly}>{t.readonly}</p>}
        {error && <p className={styles.conflict} role="alert">{error}</p>}
        {conflict && <div className={styles.conflict} role="alert"><span>{t.conflict}</span><button className={styles.secondary} type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />{t.reload}</button></div>}
        {message && <p className={styles.message} role="status">{message}</p>}
        <div className={styles.layout}>
          <aside className={styles.panel} aria-label={t.list}>
            <h2 className={styles.panelTitle}>{t.list}</h2>
            <div className={styles.list}>
              {data?.items.map((item) => <button key={item.id} className={styles.listItem} type="button" disabled={busy} aria-current={draft.id === item.id} onClick={() => { setDraft(cloneDraft(item)); setAttemptedPublish(false); setMessage(""); setError(""); }}>
                <strong>{item.localizations[locale].title || item.localizations.ko.title || t.new}</strong>
                <span className={styles.listMeta}><span>{item.kind === "regular_live" ? t.regular : t.announcement}</span><span className={item.publicationStatus === "published" ? styles.published : styles.draft}>{item.publicationStatus === "published" ? t.published : t.draft}</span></span>
              </button>)}
              {data && !data.items.length && <p className={styles.empty}>{t.empty}</p>}
            </div>
          </aside>
          <section className={styles.panel}>
            <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <div className={styles.row}>
                <label className={styles.field}>{t.kind}<select disabled={!canWrite} value={draft.kind} onChange={(event) => updateRoot({ kind: event.target.value as Draft["kind"], celebrityId: event.target.value === "regular_live" ? draft.celebrityId : null })}><option value="regular_live">{t.regular}</option><option value="announcement">{t.announcement}</option></select></label>
                <label className={styles.field}>{t.creator}<select disabled={!canWrite || draft.kind !== "regular_live"} aria-invalid={attemptedPublish && issueSet.has("celebrityId")} value={draft.celebrityId ?? ""} onChange={(event) => updateRoot({ celebrityId: event.target.value || null })}><option value="">{t.chooseCreator}</option>{data?.celebrities.map((creator) => <option key={creator.id} value={creator.id}>{locale === "ko" ? creator.nameKo : creator.nameEn}</option>)}</select></label>
              </div>
              {(["ko", "en"] as const).map((language) => {
                const localized = draft.localizations[language];
                return <fieldset key={language} className={styles.locale}><legend>{language === "ko" ? t.ko : t.en}</legend>
                  <div className={styles.row}>
                    <label className={styles.field}>{t.titleField}<input disabled={!canWrite} aria-invalid={attemptedPublish && issueSet.has(`${language}.title`)} maxLength={160} value={localized.title} onChange={(e) => updateLocalization(language, { title: e.target.value })} /></label>
                    <label className={styles.field}>{t.cta}<input disabled={!canWrite} aria-invalid={attemptedPublish && issueSet.has(`${language}.ctaLabel`)} maxLength={80} value={localized.ctaLabel} onChange={(e) => updateLocalization(language, { ctaLabel: e.target.value })} /></label>
                  </div>
                  <label className={styles.field}>{t.descriptionField}<textarea disabled={!canWrite} maxLength={600} value={localized.description} onChange={(e) => updateLocalization(language, { description: e.target.value })} /></label>
                  <div className={styles.row}>
                    <label className={styles.field}>{t.href}<input disabled={!canWrite} aria-invalid={attemptedPublish && issueSet.has(`${language}.href`)} maxLength={2048} placeholder="/live/…" value={localized.href} onChange={(e) => updateLocalization(language, { href: e.target.value })} /></label>
                    <label className={styles.field}>{t.alt}<input disabled={!canWrite} aria-invalid={attemptedPublish && issueSet.has(`${language}.alt`)} maxLength={300} value={localized.alt} onChange={(e) => updateLocalization(language, { alt: e.target.value })} /></label>
                  </div>
                  <div className={styles.images}>{(["desktopImage", "mobileImage"] as const).map((field) => {
                    const asset = localized[field]; const key = `${language}.${field}`;
                    return <section key={field} className={styles.imageCard} aria-label={field === "desktopImage" ? t.desktop : t.mobile}>
                      <h3>{field === "desktopImage" ? t.desktop : t.mobile}</h3>
                      <div className={`${styles.preview} ${field === "mobileImage" ? styles.mobile : ""}`}>{asset ? <img src={asset.url} alt={localized.alt || ""} /> : <span>{t.noImage}</span>}</div>
                      <div className={styles.imageActions}>
                        <label className={styles.uploadLabel}><ImagePlus aria-hidden="true" />{uploading === key ? "…" : t.upload}<input type="file" accept="image/*" disabled={!canWrite || !!uploading} onChange={(event) => void upload(language, field, event)} /></label>
                        {asset && <button className={styles.danger} type="button" disabled={!canWrite || !!uploading} onClick={() => updateLocalization(language, { [field]: null })}><X aria-hidden="true" />{t.remove}</button>}
                      </div>
                    </section>;
                  })}</div>
                </fieldset>;
              })}
              {attemptedPublish && issues.length > 0 && <div className={styles.issues} role="alert"><strong>{t.issues}</strong><ul>{issues.map((issue) => <li key={issue}>{labels[issue] ?? issue}</li>)}</ul></div>}
              <div className={styles.actions}>
                <button className={styles.button} type="submit" disabled={!canWrite || busy}><Save aria-hidden="true" />{draft.publicationStatus === "published" ? t.saveChanges : t.save}</button>
                {draft.id && (draft.publicationStatus === "published" ? <button className={styles.secondary} type="button" disabled={!canWrite || busy} onClick={() => void changePublication("draft")}><Undo2 aria-hidden="true" />{t.unpublish}</button> : <button className={styles.secondary} type="button" disabled={!canWrite || busy} onClick={() => void changePublication("published")}><Send aria-hidden="true" />{t.publish}</button>)}
                <span className={styles.orderActions}><button className={styles.secondary} type="button" disabled={!canWrite || busy || index <= 0} aria-label={t.up} onClick={() => void reorder(-1)}><ArrowUp aria-hidden="true" /></button><button className={styles.secondary} type="button" disabled={!canWrite || busy || !data || index < 0 || index >= data.items.length - 1} aria-label={t.down} onClick={() => void reorder(1)}><ArrowDown aria-hidden="true" /></button></span>
              </div>
            </form>
          </section>
        </div>
      </section>
    </AdminOperationsShell>
  );
}
