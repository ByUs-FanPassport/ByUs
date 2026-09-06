"use client";

import { ImagePlus, Trash2, X } from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AVATAR_CHARACTER_CATALOG,
  avatarAssetPath,
  type Avatar,
  type AvatarCharacterId,
  type AvatarCrop,
} from "../domain/avatar";
import { notifyAvatarChanged } from "./avatar-events";
import { Avatar as AvatarImage } from "./avatar";
import type { useAvatar } from "./use-avatar";
import styles from "./avatar-editor.module.css";

type AvatarResource = ReturnType<typeof useAvatar>;
type Locale = "ko" | "en";
type Dimensions = { width: number; height: number };
type Pan = { x: number; y: number };

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const copy = {
  ko: {
    avatar: "프로필 이미지",
    help: "캐릭터를 고르거나 내 사진을 사용할 수 있어요.",
    change: "변경",
    loading: "프로필 이미지를 불러오는 중",
    loadError: "프로필 이미지를 불러오지 못했어요.",
    retry: "다시 시도",
    dialogTitle: "프로필 이미지 변경",
    dialogHelp: "캐릭터 또는 사진을 선택한 뒤 저장해 주세요.",
    characters: "캐릭터 선택",
    choosePhoto: "사진 업로드",
    replacePhoto: "다른 사진 선택",
    photoHelp: "JPEG, PNG, WebP · 최대 4MB",
    crop: "사진 위치 조정",
    cropHelp: "사진을 드래그하거나 방향키로 위치를 맞추세요.",
    zoom: "확대",
    deletePhoto: "사진 삭제",
    cancel: "취소",
    save: "저장",
    saving: "저장 중…",
    invalidType: "JPEG, PNG 또는 WebP 파일을 선택해 주세요.",
    tooLarge: "4MB 이하의 사진을 선택해 주세요.",
    decodeFailed: "사진을 열지 못했어요. 다른 파일을 선택해 주세요.",
    failed: "저장하지 못했어요. 선택한 내용을 유지했으니 다시 시도해 주세요.",
    conflict: "다른 곳에서 프로필 이미지가 변경됐어요. 최신 상태를 확인한 뒤 다시 저장해 주세요.",
    refreshFailed: "최신 상태를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.",
    refresh: "최신 상태 다시 불러오기",
    photoAlt: "조정할 프로필 사진",
  },
  en: {
    avatar: "Profile image",
    help: "Choose a character or use your own photo.",
    change: "Change",
    loading: "Loading profile image",
    loadError: "We couldn't load your profile image.",
    retry: "Try again",
    dialogTitle: "Change profile image",
    dialogHelp: "Choose a character or photo, then save.",
    characters: "Choose a character",
    choosePhoto: "Upload photo",
    replacePhoto: "Choose another photo",
    photoHelp: "JPEG, PNG, WebP · up to 4MB",
    crop: "Adjust photo",
    cropHelp: "Drag the photo or use the arrow keys to position it.",
    zoom: "Zoom",
    deletePhoto: "Delete photo",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    invalidType: "Choose a JPEG, PNG, or WebP file.",
    tooLarge: "Choose a photo up to 4MB.",
    decodeFailed: "We couldn't open that photo. Choose another file.",
    failed: "We couldn't save it. Your selection is still here, so try again.",
    conflict: "Your profile image changed elsewhere. Review the latest version, then save again.",
    refreshFailed: "We couldn't load the latest version. Check your connection and try again.",
    refresh: "Reload latest version",
    photoAlt: "Profile photo being adjusted",
  },
} as const;

function clamp(value: number, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function validateAvatarFile(file: File): "type" | "size" | null {
  if (!ACCEPTED_TYPES.has(file.type)) return "type";
  if (file.size > MAX_FILE_BYTES) return "size";
  return null;
}

export function cropFromView(
  dimensions: Dimensions,
  pan: Pan,
  zoom: number,
): AvatarCrop {
  const sizePixels = Math.min(dimensions.width, dimensions.height) / zoom;
  const leftPixels = ((clamp(pan.x) + 1) / 2) * (dimensions.width - sizePixels);
  const topPixels = ((clamp(pan.y) + 1) / 2) * (dimensions.height - sizePixels);
  return {
    x: leftPixels / dimensions.width,
    y: topPixels / dimensions.height,
    size: sizePixels / Math.min(dimensions.width, dimensions.height),
  };
}

async function decodeImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("invalid dimensions");
    return { url, dimensions: { width: image.naturalWidth, height: image.naturalHeight } };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function characterLabel(id: AvatarCharacterId, locale: Locale) {
  const [shape, color] = id.split("-") as ["star" | "heart" | "fairy" | "ghost", "cream" | "pink" | "lavender"];
  const labels = locale === "ko"
    ? { star: "별", heart: "하트", fairy: "요정", ghost: "유령", cream: "크림", pink: "핑크", lavender: "라벤더" }
    : { star: "Star", heart: "Heart", fairy: "Fairy", ghost: "Ghost", cream: "Cream", pink: "Pink", lavender: "Lavender" };
  return `${labels[color]} ${labels[shape]}`;
}

export function AvatarSettings({ locale, resource }: { locale: Locale; resource: AvatarResource }) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const [editorOwner, setEditorOwner] = useState<string | null>(null);
  const [editorSnapshot, setEditorSnapshot] = useState<{ avatar: Avatar; imageUrl: string | null } | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const state = resource.state;
  const closeEditor = () => {
    setOpen(false);
    setEditorOwner(null);
    setEditorSnapshot(null);
    requestAnimationFrame(() => changeButtonRef.current?.focus());
  };
  useEffect(() => {
    if (state.status === "ready") {
      setEditorSnapshot({ avatar: state.avatar, imageUrl: state.imageUrl });
    }
  }, [state]);
  useEffect(() => {
    if (open && editorOwner && resource.ownerId !== editorOwner) closeEditor();
  }, [editorOwner, open, resource.ownerId]);
  return (
    <div className={styles.settingsRow}>
      <div className={styles.currentAvatar}>
        {state.status === "ready" ? (
          <AvatarImage avatar={state.avatar} imageUrl={state.imageUrl} label={t.avatar} size={64} />
        ) : (
          <span className={styles.loadingAvatar} aria-hidden="true" />
        )}
        <span>
          <strong>{t.avatar}</strong>
          <small>{state.status === "error" ? t.loadError : state.status === "loading" ? t.loading : t.help}</small>
        </span>
      </div>
      {state.status === "ready" ? (
        <button ref={changeButtonRef} type="button" onClick={() => {
          setEditorOwner(resource.ownerId ?? null);
          setEditorSnapshot({ avatar: state.avatar, imageUrl: state.imageUrl });
          setOpen(true);
        }}>{t.change}</button>
      ) : state.status === "error" ? (
        <button type="button" onClick={resource.refresh}>{t.retry}</button>
      ) : null}
      {open && editorSnapshot && editorOwner === resource.ownerId ? (
        <AvatarEditor
          locale={locale}
          resource={resource}
          avatar={editorSnapshot.avatar}
          imageUrl={editorSnapshot.imageUrl}
          refreshUnavailable={state.status === "error"}
          onClose={closeEditor}
        />
      ) : null}
    </div>
  );
}

export function AvatarEditor({
  locale,
  resource,
  avatar,
  imageUrl,
  refreshUnavailable = false,
  onClose,
}: {
  locale: Locale;
  resource: AvatarResource;
  avatar: Avatar;
  imageUrl: string | null;
  refreshUnavailable?: boolean;
  onClose: () => void;
}) {
  const t = copy[locale];
  const [selectedCharacter, setSelectedCharacter] = useState(avatar.characterId);
  const [characterDirty, setCharacterDirty] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const activeRef = useRef(true);
  const ownerRef = useRef(resource.ownerId);
  const mutationGenerationRef = useRef(0);
  const mutationControllerRef = useRef<AbortController | null>(null);
  const decodeGenerationRef = useRef(0);
  const previousOwnerRef = useRef(resource.ownerId);

  useEffect(() => { closeButtonRef.current?.focus(); }, []);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      mutationGenerationRef.current += 1;
      decodeGenerationRef.current += 1;
      mutationControllerRef.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    ownerRef.current = resource.ownerId;
    if (previousOwnerRef.current === resource.ownerId) return;
    previousOwnerRef.current = resource.ownerId;
    mutationGenerationRef.current += 1;
    decodeGenerationRef.current += 1;
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = null;
    setPending(false);
  }, [resource.ownerId]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const generation = ++decodeGenerationRef.current;
    const next = event.target.files?.[0];
    if (!next) return;
    const invalid = validateAvatarFile(next);
    if (invalid) {
      setError(invalid === "type" ? t.invalidType : t.tooLarge);
      event.target.value = "";
      return;
    }
    setError("");
    try {
      const decoded = await decodeImage(next);
      if (!activeRef.current || generation !== decodeGenerationRef.current) {
        URL.revokeObjectURL(decoded.url);
        return;
      }
      setFile(next);
      setCharacterDirty(false);
      setPreviewUrl(decoded.url);
      setDimensions(decoded.dimensions);
      setPan({ x: 0, y: 0 });
      setZoom(1);
    } catch {
      if (!activeRef.current || generation !== decodeGenerationRef.current) return;
      setError(t.decodeFailed);
      event.target.value = "";
    }
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const change = event.shiftKey ? 0.12 : 0.04;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    setPan((current) => ({
      x: clamp(current.x + (event.key === "ArrowLeft" ? -change : event.key === "ArrowRight" ? change : 0)),
      y: clamp(current.y + (event.key === "ArrowUp" ? -change : event.key === "ArrowDown" ? change : 0)),
    }));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dimensions) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    const previous = dragRef.current;
    if (!previous || previous.pointerId !== event.pointerId || !dimensions) return;
    const viewport = event.currentTarget.clientWidth || 280;
    const cropSize = Math.min(dimensions.width, dimensions.height) / zoom;
    const overflowX = viewport * (dimensions.width / cropSize - 1);
    const overflowY = viewport * (dimensions.height / cropSize - 1);
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    setPan((current) => ({
      x: overflowX ? clamp(current.x - (2 * deltaX) / overflowX) : 0,
      y: overflowY ? clamp(current.y - (2 * deltaY) / overflowY) : 0,
    }));
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  async function mutate(method: "PATCH" | "PUT" | "DELETE") {
    if (pending || !resource.ownerId) return;
    const ownerAtStart = resource.ownerId;
    const generation = ++mutationGenerationRef.current;
    setPending(true);
    setError("");
    try {
      const token = await resource.getAccessToken();
      if (!activeRef.current || generation !== mutationGenerationRef.current || ownerRef.current !== ownerAtStart) return;
      if (!token) throw new Error("auth");
      let body: BodyInit;
      let headers: HeadersInit = { Authorization: `Bearer ${token}` };
      if (method === "PUT") {
        if (!file || !dimensions) return;
        const form = new FormData();
        form.set("file", file);
        form.set("crop", JSON.stringify(cropFromView(dimensions, pan, zoom)));
        form.set("expectedRevision", String(avatar.revision));
        body = form;
      } else {
        headers = { ...headers, "content-type": "application/json" };
        body = JSON.stringify(method === "PATCH"
          ? { characterId: selectedCharacter, expectedRevision: avatar.revision }
          : { expectedRevision: avatar.revision });
      }
      const controller = new AbortController();
      mutationControllerRef.current = controller;
      const response = await fetch("/api/me/avatar", { method, headers, body, signal: controller.signal });
      if (!activeRef.current || generation !== mutationGenerationRef.current || ownerRef.current !== ownerAtStart) return;
      if (response.status === 409) {
        resource.refresh();
        setError(t.conflict);
        return;
      }
      if (!response.ok) throw new Error("save");
      notifyAvatarChanged(ownerAtStart);
      onClose();
    } catch (caught) {
      if (!activeRef.current || generation !== mutationGenerationRef.current || ownerRef.current !== ownerAtStart) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(t.failed);
    } finally {
      if (mutationControllerRef.current?.signal.aborted || generation === mutationGenerationRef.current) {
        mutationControllerRef.current = null;
      }
      if (activeRef.current && generation === mutationGenerationRef.current && ownerRef.current === ownerAtStart) setPending(false);
    }
  }

  const crop = dimensions ? cropFromView(dimensions, pan, zoom) : null;
  const previewStyle = dimensions && crop ? {
    width: `${(dimensions.width / Math.min(dimensions.width, dimensions.height)) * zoom * 100}%`,
    height: `${(dimensions.height / Math.min(dimensions.width, dimensions.height)) * zoom * 100}%`,
    left: `${-(crop.x * dimensions.width / Math.min(dimensions.width, dimensions.height)) * zoom * 100}%`,
    top: `${-(crop.y * dimensions.height / Math.min(dimensions.width, dimensions.height)) * zoom * 100}%`,
  } : undefined;

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), [tabindex='0']",
    ) ?? [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="avatar-dialog-title" onKeyDown={handleDialogKeyDown}>
        <header>
          <div><h3 id="avatar-dialog-title">{t.dialogTitle}</h3><p>{t.dialogHelp}</p></div>
          <button ref={closeButtonRef} type="button" className={styles.close} aria-label={t.cancel} disabled={pending} onClick={onClose}><X /></button>
        </header>

        <div className={styles.editorBody}>
          <section aria-labelledby="avatar-character-title">
            <h4 id="avatar-character-title">{t.characters}</h4>
            <div className={styles.characterGrid}>
              {AVATAR_CHARACTER_CATALOG.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  aria-label={characterLabel(character.id, locale)}
                  aria-pressed={!file && selectedCharacter === character.id && (characterDirty || !avatar.hasImage)}
                  disabled={pending}
                  onClick={() => {
                    decodeGenerationRef.current += 1;
                    setSelectedCharacter(character.id);
                    setCharacterDirty(true);
                    setFile(null);
                    setPreviewUrl(null);
                    setDimensions(null);
                    setError("");
                  }}
                >
                  <img src={avatarAssetPath(character.id)} alt="" width="64" height="64" />
                </button>
              ))}
            </div>
          </section>

          <section className={styles.photoSection} aria-labelledby="avatar-photo-title">
            <div className={styles.photoHeading}>
              <div><h4 id="avatar-photo-title">{file ? t.crop : t.choosePhoto}</h4><p>{file ? t.cropHelp : t.photoHelp}</p></div>
              <label className={styles.fileButton}>
                <ImagePlus aria-hidden="true" />
                <span>{file || avatar.hasImage ? t.replacePhoto : t.choosePhoto}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={(event) => void chooseFile(event)} />
              </label>
            </div>
            {file && previewUrl && dimensions ? (
              <>
                <div
                  className={styles.cropViewport}
                  role="img"
                  aria-label={t.photoAlt}
                  tabIndex={0}
                  onKeyDown={moveWithKeyboard}
                  onPointerDown={startDrag}
                  onPointerMove={drag}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                >
                  <img src={previewUrl} alt="" draggable={false} style={previewStyle as CSSProperties} />
                </div>
                <label className={styles.zoomControl}>
                  <span>{t.zoom}</span>
                  <input aria-label={t.zoom} type="range" min="1" max="3" step="0.05" value={zoom} disabled={pending} onChange={(event) => setZoom(Number(event.target.value))} />
                  <output>{Math.round(zoom * 100)}%</output>
                </label>
              </>
            ) : (
              <div className={styles.currentPreview}>
                <AvatarImage
                  avatar={characterDirty ? { ...avatar, characterId: selectedCharacter, hasImage: false } : avatar}
                  imageUrl={characterDirty ? null : imageUrl}
                  label={t.avatar}
                  size={96}
                />
              </div>
            )}
          </section>
        </div>

        <footer>
          <div>
            {avatar.hasImage ? <button type="button" className={styles.deleteButton} disabled={pending} onClick={() => void mutate("DELETE")}><Trash2 />{t.deletePhoto}</button> : null}
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={pending} onClick={onClose}>{t.cancel}</button>
            <button type="button" className={styles.saveButton} disabled={pending || (!file && !characterDirty)} aria-busy={pending} onClick={() => void mutate(file ? "PUT" : "PATCH")}>{pending ? t.saving : t.save}</button>
          </div>
        </footer>
        <p className={styles.error} role="alert" aria-live="polite">{error}</p>
        {refreshUnavailable ? (
          <div className={styles.refreshError}>
            <span>{t.refreshFailed}</span>
            <button type="button" disabled={pending} onClick={resource.refresh}>{t.refresh}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
