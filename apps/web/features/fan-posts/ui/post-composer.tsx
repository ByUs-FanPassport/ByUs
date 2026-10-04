"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ImagePlus } from "lucide-react";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import { FanAction } from "@/components/fan-ui/fan-action";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import { assetSchema, type ContentAsset, type FanPost } from "../domain/content";
import { ContentAssetImage } from "@/features/content-safety/ui/content-asset";
import { useContentMutation } from "@/features/content-safety/ui/use-content-mutation";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import type { AppLocale } from "@/i18n/locales";
import styles from "@/features/content-safety/ui/content.module.css";

export function PostComposer({ slug, locale, post, onSaved, onCancel, featured = false, autoFocus = false }: { slug: string; locale: AppLocale; post?: FanPost; onSaved: () => void; onCancel?: () => void; featured?: boolean; autoFocus?: boolean }) {
  const copy = contentCopy(locale), mutation = useContentMutation(locale), fieldId = useId();
  const [body, setBody] = useState(post?.body ?? ""), [visibility, setVisibility] = useState<"public" | "members">(post?.visibility ?? "public");
  const [assets, setAssets] = useState<ContentAsset[]>(post?.assets ?? []), [problem, setProblem] = useState(""), [visibilityOpen, setVisibilityOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false), photoInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ snapshot: string; key: string } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 47.999rem)");
    const sync = () => setIsMobile(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.length + assets.length > 4 || selectedFiles.some(file => file.size > 8 * 1024 * 1024)) { setProblem(copy.photoLimit); return; }
    setProblem("");
    for (const file of selectedFiles) {
      const form = new FormData(); form.set("file", file); form.set("celebritySlug", slug);
      const result = await mutation.request("/api/content-assets", "POST", form);
      if (!result) { setProblem(copy.failed); break; }
      const parsed = assetSchema.safeParse((result as { asset?: unknown } | null)?.asset);
      if (!parsed.success) { setProblem(copy.failed); break; }
      setAssets(current => [...current, parsed.data]);
    }
  }
  async function save() {
    const value = { body: body.trim(), visibility, assetIds: assets.map(asset => asset.id) }, snapshot = JSON.stringify(value);
    if (!attempt.current || attempt.current.snapshot !== snapshot) attempt.current = { snapshot, key: crypto.randomUUID() };
    const result = post ? await mutation.request(`/api/posts/${post.id}`, "PATCH", { ...value, expectedRevision: post.revision })
      : await mutation.request(`/api/celebrities/${slug}/posts`, "POST", { ...value, idempotencyKey: attempt.current.key });
    if (result) { setBody(""); setAssets([]); attempt.current = null; onSaved(); }
  }
  return <form className={`${styles.composer}${featured ? ` ${styles.composerFeatured}` : ""}`} onSubmit={event => { event.preventDefault(); void save(); }}>
    <label htmlFor={`${fieldId}-body`}>{post ? copy.edit : copy.writePost}<textarea id={`${fieldId}-body`} rows={3} autoFocus={autoFocus} placeholder={discoveryCopy(locale).writePrompt} maxLength={5000} value={body} disabled={mutation.busy} onChange={event => setBody(event.target.value)} /></label>
    {assets.length > 0 && <div className={styles.photos}>{assets.map(asset => <figure key={asset.id}>
      <ContentAssetImage asset={asset} locale={locale} alt={copy.photo} /><button type="button" className={styles.button} disabled={mutation.busy} onClick={() => setAssets(current => current.filter(item => item.id !== asset.id))}>{copy.delete}</button>
    </figure>)}</div>}
    <div className={styles.composerTools}>
      <button type="button" className={styles.visibilityTrigger} disabled={mutation.busy} aria-label={`${copy.visibility}: ${copy[visibility]}`} aria-haspopup="dialog" aria-expanded={visibilityOpen} onClick={() => setVisibilityOpen(true)}>
        <span>{copy.visibility}</span><strong>{copy[visibility]}</strong><ChevronDown size={16} aria-hidden="true" />
      </button>
      <div className={styles.photoPicker}>
        <button type="button" disabled={mutation.busy || assets.length >= 4} aria-describedby={`${fieldId}-hint${problem ? ` ${fieldId}-photo-error` : ""}`} onClick={() => photoInput.current?.click()}><ImagePlus size={18} aria-hidden="true" /><span>{copy.photos}{assets.length ? ` · ${assets.length}/4` : ""}</span></button>
        <input ref={photoInput} type="file" tabIndex={-1} accept="image/jpeg,image/png,image/webp" multiple disabled={mutation.busy || assets.length >= 4} aria-label={copy.photos} aria-describedby={`${fieldId}-hint${problem ? ` ${fieldId}-photo-error` : ""}`} aria-invalid={problem ? true : undefined} onChange={event => { void upload(event.target.files); event.target.value = ""; }} />
      </div>
    </div>
    {visibilityOpen && <AccessibleOverlay open onClose={() => setVisibilityOpen(false)} labelledBy={`${fieldId}-visibility-title`} backdropClassName={styles.visibilityBackdrop} contentClassName={styles.visibilityDialog} contentAs="section" variant={isMobile ? "bottom-sheet" : "dialog"} busy={mutation.busy}>
      <h2 id={`${fieldId}-visibility-title`}>{copy.visibility}</h2>
      <fieldset className={styles.visibility} disabled={mutation.busy} aria-describedby={visibility === "members" ? `${fieldId}-members-hint` : undefined}>{(["public", "members"] as const).map(value => <label key={value}><input type="radio" name={`${fieldId}-visibility`} value={value} checked={visibility === value} onChange={() => { setVisibility(value); setVisibilityOpen(false); }} /><span>{copy[value]}</span></label>)}</fieldset>
      <div className={styles.visibilityActions}><button type="button" onClick={() => setVisibilityOpen(false)}>{copy.cancel}</button></div>
    </AccessibleOverlay>}
    {visibility === "members" && <small id={`${fieldId}-members-hint`} className={styles.hint}>{copy.memberRequired}</small>}
    <small id={`${fieldId}-hint`} className={styles.hint}>{copy.photoLimit}</small>
    <div className={styles.actions}><FanAction variant="primary" type="submit" disabled={mutation.busy || (!body.trim() && !assets.length)} ariaBusy={mutation.busy}>{mutation.busy ? copy.loading : post ? copy.save : copy.publish}</FanAction>{onCancel && <FanAction disabled={mutation.busy} onClick={onCancel}>{copy.cancel}</FanAction>}</div>
    {(problem || mutation.error) && <p id={problem ? `${fieldId}-photo-error` : undefined} className={styles.error} role="alert">{problem || mutation.error}</p>}
  </form>;
}
