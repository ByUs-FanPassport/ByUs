"use client";

import { ImagePlus, Link as LinkIcon, RefreshCw, Save, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  creatorPhotoRoles,
  eventPhotoRoles,
  imageSlots,
  photoSlots,
  type ImageRoleRecord,
  type PhotoBinding,
  type PhotoFrame,
  type PhotoOwner,
  type PhotoRole,
  type PublicImageAsset,
} from "@/features/media/domain/public-image";
import type { AdminLocale } from "./operations-shell";
import styles from "./image-role-editor.module.css";

type Props = {
  ownerType: PhotoOwner;
  ownerId: string;
  locale: AdminLocale;
  canEdit: boolean;
  getAccessToken: () => Promise<string | null>;
};

const roleLabels: Record<PhotoRole, { ko: string; en: string }> = {
  profile: { ko: "프로필", en: "Profile" },
  portrait: { ko: "세로", en: "Portrait" },
  landscape: { ko: "가로", en: "Landscape" },
  poster: { ko: "포스터", en: "Poster" },
};

const slotLabels: Record<string, { ko: string; en: string }> = {
  "identity.square": { ko: "정사각형 프로필", en: "Square profile" },
  "identity.avatar": { ko: "작은 아바타", en: "Small avatar" },
  "identity.passport": { ko: "팬 패스포트", en: "Fan Passport" },
  "creator.hero.mobile": { ko: "모바일 셀럽 홈", en: "Mobile creator home" },
  "creator.vertical": { ko: "세로 목록", en: "Portrait list" },
  "creator.calendar": { ko: "캘린더", en: "Calendar" },
  "creator.hero.desktop": { ko: "데스크톱 셀럽 홈", en: "Desktop creator home" },
  "creator.collection": { ko: "컬렉션", en: "Collection" },
  "event.home.desktop": { ko: "데스크톱 LIVE 홈", en: "Desktop LIVE home" },
  "event.home.mobile": { ko: "모바일 LIVE 홈", en: "Mobile LIVE home" },
  "event.detail": { ko: "LIVE 상세", en: "LIVE detail" },
  "event.poster": { ko: "LIVE 포스터", en: "LIVE poster" },
};

function cloneBinding(binding: PhotoBinding | null): PhotoBinding | null {
  return binding
    ? {
        ...binding,
        asset: { ...binding.asset },
        alt: { ...binding.alt },
        frames: Object.fromEntries(
          Object.entries(binding.frames).map(([slot, frame]) => [slot, frame ? { ...frame } : frame]),
        ),
      }
    : null;
}

function framesForAsset(ownerType: PhotoOwner, role: PhotoRole, binding: PhotoBinding | null) {
  return Object.fromEntries(
    photoSlots(ownerType, role).map((slot) => {
      const current = binding?.frames[slot];
      return [slot, { fit: current?.fit ?? "contain", x: current?.x ?? 50, y: current?.y ?? 50, approvedAssetRevision: null } satisfies PhotoFrame];
    }),
  ) as PhotoBinding["frames"];
}

export function ImageRoleEditor({ ownerType, ownerId, locale, canEdit, getAccessToken }: Props) {
  const roles = ownerType === "celebrity" ? creatorPhotoRoles : eventPhotoRoles;
  const [records, setRecords] = useState<ImageRoleRecord[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<PhotoRole, PhotoBinding | null>>>({});
  const [urls, setUrls] = useState<Partial<Record<PhotoRole, string>>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busyRole, setBusyRole] = useState<PhotoRole | null>(null);
  const [message, setMessage] = useState("");

  const copy = useMemo(
    () => locale === "ko" ? {
      title: "공개 이미지 역할",
      description: "화면 비율에 맞는 사진과 노출 위치를 역할별로 지정합니다. 변경한 역할은 ‘적용’을 눌러야 반영됩니다.",
      loading: "이미지 역할을 불러오는 중입니다.",
      loadError: "이미지 역할을 불러오지 못했습니다.",
      retry: "다시 불러오기",
      upload: "파일 업로드",
      importUrl: "URL 가져오기",
      url: "이미지 URL",
      altKo: "한국어 대체 텍스트",
      altEn: "English alt text",
      fit: "맞춤 방식",
      positionX: "가로 위치",
      positionY: "세로 위치",
      approve: "이 원본과 위치로 크롭 승인",
      approvalNeeded: "영역을 채우려면 각 화면의 잘린 부분을 확인하고 승인하세요.",
      apply: "이 역할 적용",
      remove: "이미지 연결 해제",
      empty: "연결된 이미지가 없습니다. 파일을 올리거나 URL로 가져오세요.",
      applied: "이미지 역할을 적용했습니다.",
      failed: "변경사항을 적용하지 못했습니다.",
      conflict: "다른 관리자가 먼저 변경했습니다. 최신 값을 다시 불러왔습니다.",
      assetFailed: "이미지를 등록하지 못했습니다.",
      readonly: "Viewer 권한은 현재 설정만 볼 수 있습니다.",
      revision: "설정 버전",
    } : {
      title: "Public image roles",
      description: "Assign a photo and framing for each display role. Select Apply to publish changes to a role.",
      loading: "Loading image roles.",
      loadError: "Image roles could not be loaded.",
      retry: "Reload",
      upload: "Upload file",
      importUrl: "Import URL",
      url: "Image URL",
      altKo: "Korean alt text",
      altEn: "English alt text",
      fit: "Fit",
      positionX: "Horizontal position",
      positionY: "Vertical position",
      approve: "Approve this crop for this asset",
      approvalNeeded: "Review and approve every crop before applying cover.",
      apply: "Apply this role",
      remove: "Disconnect image",
      empty: "No image is connected. Upload a file or import a URL.",
      applied: "Image role applied.",
      failed: "Changes could not be applied.",
      conflict: "Another admin changed this role first. The latest values were reloaded.",
      assetFailed: "The image could not be registered.",
      readonly: "Viewer access is read-only.",
      revision: "Revision",
    },
    [locale],
  );

  const authorizedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const token = await getAccessToken();
    if (!token) throw new Error("auth");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-correlation-id", crypto.randomUUID());
    return fetch(input, { ...init, headers, cache: "no-store" });
  }, [getAccessToken]);

  const load = useCallback(async (conflict = false) => {
    setStatus("loading");
    try {
      const query = new URLSearchParams({ ownerType, ownerId });
      const response = await authorizedFetch(`/api/admin/image-roles?${query}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { items: ImageRoleRecord[] };
      setRecords(payload.items);
      setDrafts(Object.fromEntries(roles.map((role) => [role, cloneBinding(payload.items.find((item) => item.role === role)?.binding ?? null)])));
      setMessage(conflict ? copy.conflict : "");
      setStatus("ready");
    } catch {
      setStatus("error");
      setMessage(copy.loadError);
    }
  }, [authorizedFetch, copy.conflict, copy.loadError, ownerId, ownerType, roles]);

  useEffect(() => { void load(); }, [load]);

  function replaceAsset(role: PhotoRole, asset: PublicImageAsset) {
    setDrafts((current) => {
      const previous = current[role] ?? null;
      return {
        ...current,
        [role]: {
          asset,
          alt: previous?.alt ?? { ko: "", en: "" },
          frames: framesForAsset(ownerType, role, previous),
          revision: previous?.revision ?? 0,
        },
      };
    });
  }

  async function registerAsset(role: PhotoRole, body: FormData | { url: string }) {
    if (!canEdit || busyRole) return;
    setBusyRole(role);
    setMessage("");
    try {
      const isForm = body instanceof FormData;
      const response = await authorizedFetch("/api/admin/image-assets", {
        method: "POST",
        headers: isForm ? undefined : { "content-type": "application/json" },
        body: isForm ? body : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { asset: PublicImageAsset };
      replaceAsset(role, payload.asset);
      setUrls((current) => ({ ...current, [role]: "" }));
    } catch {
      setMessage(copy.assetFailed);
    } finally {
      setBusyRole(null);
    }
  }

  function updateBinding(role: PhotoRole, update: (binding: PhotoBinding) => PhotoBinding) {
    setDrafts((current) => {
      const binding = current[role];
      return binding ? { ...current, [role]: update(binding) } : current;
    });
  }

  function updateFrame(role: PhotoRole, slot: keyof typeof imageSlots, patch: Partial<PhotoFrame>, approve = false) {
    updateBinding(role, (binding) => {
      const frame = binding.frames[slot] ?? { fit: "contain", x: 50, y: 50, approvedAssetRevision: null };
      return {
        ...binding,
        frames: {
          ...binding.frames,
          [slot]: {
            ...frame,
            ...patch,
            approvedAssetRevision: approve ? binding.asset.revision : null,
          },
        },
      };
    });
  }

  async function apply(role: PhotoRole) {
    if (!canEdit || busyRole) return;
    setBusyRole(role);
    setMessage("");
    try {
      const binding = drafts[role] ?? null;
      const expectedRevision = records.find((item) => item.role === role)?.revision ?? 0;
      const response = await authorizedFetch("/api/admin/image-roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerType,
          ownerId,
          role,
          expectedRevision,
          binding: binding ? { assetId: binding.asset.id, alt: binding.alt, frames: binding.frames } : null,
        }),
      });
      if (response.status === 409) {
        await load(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { item: ImageRoleRecord };
      setRecords((current) => [...current.filter((item) => item.role !== role), payload.item]);
      setDrafts((current) => ({ ...current, [role]: cloneBinding(payload.item.binding) }));
      setMessage(copy.applied);
      setStatus("ready");
    } catch {
      setMessage(copy.failed);
    } finally {
      setBusyRole(null);
    }
  }

  if (status === "loading") return <section className={styles.editor} aria-busy="true"><h2>{copy.title}</h2><p>{copy.loading}</p></section>;
  if (status === "error") return <section className={styles.editor}><h2>{copy.title}</h2><p role="alert">{message}</p><button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />{copy.retry}</button></section>;

  return (
    <section className={styles.editor} aria-labelledby={`${ownerType}-image-role-title`}>
      <header>
        <div><h2 id={`${ownerType}-image-role-title`}><ImagePlus aria-hidden="true" />{copy.title}</h2><p>{copy.description}</p></div>
        {!canEdit && <span>{copy.readonly}</span>}
      </header>
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.roles}>
        {roles.map((role) => {
          const binding = drafts[role] ?? null;
          const revision = records.find((item) => item.role === role)?.revision ?? 0;
          const slots = photoSlots(ownerType, role);
          const missingApproval = Boolean(binding && slots.some((slot) => {
            const frame = binding.frames[slot];
            return frame?.fit === "cover" && frame.approvedAssetRevision !== binding.asset.revision;
          }));
          const missingAlt = Boolean(binding && (!binding.alt.ko.trim() || !binding.alt.en.trim()));
          const urlInputId = `${ownerType}-${ownerId}-${role}-image-url`;
          return (
            <article className={styles.role} key={role} aria-busy={busyRole === role}>
              <div className={styles.roleHeading}><div><h3>{roleLabels[role][locale]}</h3><small>{copy.revision} {revision}</small></div>{binding && <img src={binding.asset.url} alt="" />}</div>
              <div className={styles.sourceActions}>
                <label className={styles.uploadButton}>
                  <Upload aria-hidden="true" />{copy.upload}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!canEdit || busyRole !== null} onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const data = new FormData(); data.set("file", file); void registerAsset(role, data); event.target.value = "";
                  }} />
                </label>
                <div className={styles.urlField}><label htmlFor={urlInputId}>{copy.url}</label><div><input id={urlInputId} type="url" value={urls[role] ?? ""} disabled={!canEdit || busyRole !== null} onChange={(event) => setUrls((current) => ({ ...current, [role]: event.target.value }))} /><button type="button" disabled={!canEdit || busyRole !== null || !(urls[role] ?? "").trim()} onClick={() => void registerAsset(role, { url: (urls[role] ?? "").trim() })}><LinkIcon aria-hidden="true" />{copy.importUrl}</button></div></div>
              </div>
              {!binding ? <p className={styles.empty}>{copy.empty}</p> : <>
                <div className={styles.altGrid}>
                  <label><span>{copy.altKo}</span><input value={binding.alt.ko} disabled={!canEdit || busyRole !== null} onChange={(event) => updateBinding(role, (current) => ({ ...current, alt: { ...current.alt, ko: event.target.value } }))} /></label>
                  <label><span>{copy.altEn}</span><input value={binding.alt.en} disabled={!canEdit || busyRole !== null} onChange={(event) => updateBinding(role, (current) => ({ ...current, alt: { ...current.alt, en: event.target.value } }))} /></label>
                </div>
                <div className={styles.frames}>{slots.map((slot) => {
                  const frame = binding.frames[slot] ?? { fit: "contain", x: 50, y: 50, approvedAssetRevision: null };
                  const approved = frame.approvedAssetRevision === binding.asset.revision;
                  return <fieldset key={slot}><legend>{slotLabels[slot]?.[locale] ?? slot}<small>{imageSlots[slot].width} × {imageSlots[slot].height}</small></legend><div className={styles.framePreview} style={{ borderRadius: slot === "identity.avatar" ? "50%" : undefined, aspectRatio: `${imageSlots[slot].width} / ${imageSlots[slot].height}`, maxWidth: `${320 * imageSlots[slot].width / imageSlots[slot].height}px` }}><img src={binding.asset.url} alt="" style={{ objectFit: frame.fit, objectPosition: `${frame.x}% ${frame.y}%` }} /></div><div className={styles.frameControls}><label><span>{copy.fit}</span><select value={frame.fit} disabled={!canEdit || busyRole !== null} onChange={(event) => updateFrame(role, slot, { fit: event.target.value as PhotoFrame["fit"] })}><option value="contain">{locale === "ko" ? "전체 보기" : "Show full image"}</option><option value="cover">{locale === "ko" ? "영역 채우기" : "Fill frame"}</option></select></label><label><span>{copy.positionX} · {frame.x}%</span><input type="range" min="0" max="100" value={frame.x} disabled={!canEdit || busyRole !== null} onChange={(event) => updateFrame(role, slot, { x: Number(event.target.value) })} /></label><label><span>{copy.positionY} · {frame.y}%</span><input type="range" min="0" max="100" value={frame.y} disabled={!canEdit || busyRole !== null} onChange={(event) => updateFrame(role, slot, { y: Number(event.target.value) })} /></label></div>{frame.fit === "cover" && <label className={styles.approval}><input type="checkbox" checked={approved} disabled={!canEdit || busyRole !== null} onChange={(event) => updateFrame(role, slot, {}, event.target.checked)} /><span>{copy.approve}</span></label>}</fieldset>;
                })}</div>
              </>}
              {missingApproval && <p className={styles.warning}>{copy.approvalNeeded}</p>}
              <div className={styles.actions}>{binding && <button type="button" className={styles.secondary} disabled={!canEdit || busyRole !== null} onClick={() => setDrafts((current) => ({ ...current, [role]: null }))}>{copy.remove}</button>}<button type="button" disabled={!canEdit || busyRole !== null || missingApproval || missingAlt} onClick={() => void apply(role)}><Save aria-hidden="true" />{copy.apply}</button></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
