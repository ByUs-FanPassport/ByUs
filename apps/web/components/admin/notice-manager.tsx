"use client";
import { usePrivy } from "@privy-io/react-auth";
import { EditorContent, useEditor } from "@tiptap/react";
import { Archive, Bold, ImagePlus, Italic, Link2, List, ListOrdered, Pin, Save, Underline as UnderlineIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { noticeExtensions } from "../notice/tiptap-extensions";
import { NoticeBody } from "../notice/notice-body";
import type { TiptapDocument } from "../../server/notice/notice-domain";
import type { AdminLocale } from "./operations-shell";
import styles from "./notice-manager.module.css";

type Document = Record<string, unknown>;
type Notice = {
  id: string;
  slug: string;
  publicationStatus: "draft" | "published";
  pinned: boolean;
  publishedAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  revision: number;
  localizations: { ko: { title: string; body: Document }; en: { title: string; body: Document } };
};
const emptyDocument: Document = { type: "doc", content: [{ type: "paragraph" }] };

function normalize(row: any): Notice {
  const localizations = Array.isArray(row.celebrity_notice_localizations) ? row.celebrity_notice_localizations : [];
  const loc = (locale: "ko" | "en") => {
    const value = localizations.find((item: any) => item.locale === locale);
    return { title: value?.title ?? "", body: value?.body_json ?? emptyDocument };
  };
  return {
    id: row.id, slug: row.slug, publicationStatus: row.publication_status, pinned: row.pinned,
    publishedAt: row.published_at, archivedAt: row.archived_at, archiveReason: row.archive_reason,
    revision: row.revision, localizations: { ko: loc("ko"), en: loc("en") },
  };
}

export function NoticeManager({ celebrityId, celebrityName, role, locale }: { celebrityId: string; celebrityName: string; role: string; locale: AdminLocale }) {
  const { getAccessToken } = usePrivy();
  const canEdit = role !== "viewer";
  const [items, setItems] = useState<Notice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [language, setLanguage] = useState<"ko" | "en">("ko");
  const [slug, setSlug] = useState("");
  const [pinned, setPinned] = useState(false);
  const [titles, setTitles] = useState({ ko: "", en: "" });
  const [bodies, setBodies] = useState<{ ko: Document; en: Document }>({ ko: emptyDocument, en: emptyDocument });
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const current = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const request = useCallback(async (method: string, body?: unknown) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Missing access token");
    const response = await fetch(`/api/admin/celebrities/${celebrityId}/notices`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": crypto.randomUUID() },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message ?? "Notice request failed");
    return payload;
  }, [celebrityId, getAccessToken]);
  const load = useCallback(async () => {
    try {
      const payload = await request("GET");
      setItems((payload.notices ?? []).map(normalize));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Notice load failed"); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!current) return;
    setSlug(current.slug); setPinned(current.pinned);
    setTitles({ ko: current.localizations.ko.title, en: current.localizations.en.title });
    setBodies({ ko: current.localizations.ko.body, en: current.localizations.en.body });
  }, [current]);
  const editor = useEditor({
    extensions: noticeExtensions,
    content: bodies[language],
    immediatelyRender: false,
    editable: canEdit && !current?.archivedAt && current?.publicationStatus !== "published",
    onUpdate: ({ editor: active }) => setBodies((value) => ({ ...value, [language]: active.getJSON() })),
  }, [language, selectedId, canEdit, current?.archivedAt, current?.publicationStatus]);
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(bodies[language])) {
      editor.commands.setContent(bodies[language]);
    }
  }, [bodies, editor, language]);

  function reset() {
    setSelectedId(null); setSlug(""); setPinned(false); setTitles({ ko: "", en: "" });
    setBodies({ ko: emptyDocument, en: emptyDocument }); setMessage("");
  }
  async function save() {
    try {
      const result = await request("POST", {
        action: "save", id: current?.id, expectedRevision: current?.revision, slug, pinned,
        localizations: {
          ko: { title: titles.ko, body: bodies.ko },
          en: { title: titles.en, body: bodies.en },
        },
      });
      await load(); setSelectedId(result.id); setMessage(locale === "ko" ? "공지를 저장했습니다." : "Notice saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
  }
  async function state(action: "publish" | "unpublish" | "archive") {
    if (!current) return;
    const reason = action === "archive" ? prompt(locale === "ko" ? "보관 사유를 10자 이상 입력하세요." : "Enter an archive reason (10+ characters).") : undefined;
    if (action === "archive" && !reason) return;
    try {
      await request("POST", { action, id: current.id, expectedRevision: current.revision, reason });
      await load(); setMessage(locale === "ko" ? "공지 상태를 변경했습니다." : "Notice state updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "State update failed"); }
  }
  async function upload(file: File) {
    if (!current) { setMessage(locale === "ko" ? "이미지를 추가하려면 공지를 먼저 저장하세요." : "Save the Notice before adding images."); return; }
    try {
      const alt = prompt(locale === "ko" ? "이미지 대체 텍스트를 입력하세요." : "Enter image alt text.");
      if (!alt?.trim()) throw new Error(locale === "ko" ? "이미지 대체 텍스트가 필요합니다." : "Image alt text is required.");
      const token = await getAccessToken();
      const data = new FormData(); data.set("file", file);
      const response = await fetch(`/api/admin/celebrities/${celebrityId}/notices/${current.id}/assets`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "x-correlation-id": crypto.randomUUID() }, body: data,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Upload failed");
      editor?.chain().focus().setImage({ src: payload.url, alt: alt.trim() }).run();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
  }
  function addLink() {
    const href = prompt("https://");
    if (!href) return;
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      editor?.chain().focus().extendMarkRange("link").setLink({ href: url.toString() }).run();
    } catch {
      setMessage(locale === "ko" ? "HTTPS 링크만 사용할 수 있습니다." : "Only HTTPS links are allowed.");
    }
  }
  const toolbarDisabled = !editor?.isEditable;

  return <section className={styles.manager} aria-labelledby="notice-manager-title">
    <header><div><p>ADM · Notice CMS</p><h2 id="notice-manager-title">{celebrityName} {locale === "ko" ? "공지" : "Notices"}</h2></div>{canEdit && <button type="button" onClick={reset}>{locale === "ko" ? "새 공지" : "New Notice"}</button>}</header>
    <div className={styles.layout}>
      <div className={styles.list}>{items.map((item) => <button type="button" key={item.id} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.localizations[locale].title || item.slug}</strong><span>{item.archivedAt ? "ARCHIVED" : item.publicationStatus.toUpperCase()} · r{item.revision}</span></button>)}</div>
      <div className={styles.editor}>
        <div className={styles.language}><button type="button" aria-pressed={language === "ko"} onClick={() => setLanguage("ko")}>KO</button><button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button></div>
        <div className={styles.fields}><label><span>Slug</span><input disabled={!canEdit || !!current?.archivedAt || current?.publicationStatus === "published"} value={slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={(event) => setSlug(event.target.value)} /></label><label><span>{locale === "ko" ? "제목" : "Title"}</span><input disabled={!canEdit || !!current?.archivedAt || current?.publicationStatus === "published"} value={titles[language]} onChange={(event) => setTitles((value) => ({ ...value, [language]: event.target.value }))} /></label><label className={styles.pin}><input type="checkbox" disabled={!canEdit || !!current?.archivedAt || current?.publicationStatus === "published"} checked={pinned} onChange={(event) => setPinned(event.target.checked)} /><Pin />{locale === "ko" ? "상단 고정" : "Pin Notice"}</label></div>
        <div className={styles.toolbar} aria-label={locale === "ko" ? "본문 서식" : "Body formatting"}>
          <button type="button" disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold"><Bold /></button>
          <button type="button" disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic"><Italic /></button>
          <button type="button" disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleUnderline().run()} aria-label="Underline"><UnderlineIcon /></button>
          <button type="button" disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="Bullet list"><List /></button>
          <button type="button" disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-label="Ordered list"><ListOrdered /></button>
          <button type="button" disabled={toolbarDisabled} onClick={addLink} aria-label="Link"><Link2 /></button>
          <button type="button" disabled={toolbarDisabled} onClick={() => fileRef.current?.click()} aria-label={locale === "ko" ? "이미지 업로드" : "Upload image"}><ImagePlus /></button>
          <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        </div>
        <EditorContent editor={editor} className={styles.body} />
        <section className={styles.preview} aria-labelledby="notice-preview-title">
          <h3 id="notice-preview-title">{locale === "ko" ? "공개 화면 미리보기" : "Public preview"}</h3>
          <h4>{titles[language] || (language === "ko" ? "공지 제목" : "Notice title")}</h4>
          <NoticeBody document={bodies[language] as TiptapDocument} locale={language} />
        </section>
        {message && <p role="status" className={styles.message}>{message}</p>}
        <div className={styles.actions}>{canEdit && !current?.archivedAt && current?.publicationStatus !== "published" && <button type="button" onClick={() => void save()}><Save />{locale === "ko" ? "저장" : "Save"}</button>}{canEdit && current && !current.archivedAt && <button type="button" onClick={() => void state(current.publicationStatus === "published" ? "unpublish" : "publish")}>{current.publicationStatus === "published" ? (locale === "ko" ? "공개 중지" : "Unpublish") : (locale === "ko" ? "공개" : "Publish")}</button>}{canEdit && current && !current.archivedAt && <button type="button" onClick={() => void state("archive")}><Archive />{locale === "ko" ? "보관" : "Archive"}</button>}</div>
      </div>
    </div>
  </section>;
}
