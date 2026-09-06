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
import { Avatar as AvatarImage } from "./avatar";
import { avatarEditorCopy } from "./avatar-editor-copy";
import { notifyAvatarChanged } from "./avatar-events";
import type { useAvatar } from "./use-avatar";
import styles from "./avatar-editor.module.css";

type AvatarResource = ReturnType<typeof useAvatar>;
type Locale = "ko" | "en";
type Dimensions = { width: number; height: number };
type Pan = { x: number; y: number };

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const copy = avatarEditorCopy;

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

// Compatibility for existing callers; the settings entry point imports its lightweight module.
export { AvatarSettings } from "./avatar-settings";

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
