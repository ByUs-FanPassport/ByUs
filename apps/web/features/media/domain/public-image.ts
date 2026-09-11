/** Public editorial photos only. Private avatars and certification proofs never enter this contract. */
export const creatorPhotoRoles = ["profile", "portrait", "landscape"] as const;
export const eventPhotoRoles = ["landscape", "portrait", "poster"] as const;
export type PhotoRole = "profile" | "portrait" | "landscape" | "poster";
export type PhotoOwner = "celebrity" | "live";
export const imageSlots = {
  "identity.square": { role: "profile", width: 440, height: 440 },
  "identity.avatar": { role: "profile", width: 64, height: 64 },
  "identity.passport": { role: "profile", width: 440, height: 354 },
  "creator.hero.mobile": { role: "portrait", width: 440, height: 470 },
  "creator.vertical": { role: "portrait", width: 72, height: 96 },
  "creator.calendar": { role: "portrait", width: 320, height: 392 },
  "creator.hero.desktop": { role: "landscape", width: 940, height: 360 },
  "creator.collection": { role: "landscape", width: 640, height: 440 },
  "event.home.desktop": { role: "landscape", width: 1360, height: 680 },
  "event.home.mobile": { role: "portrait", width: 440, height: 550 },
  "event.detail": { role: "landscape", width: 960, height: 480 },
  "event.poster": { role: "poster", width: 960, height: 480 },
} as const;
export type ImageSlot = keyof typeof imageSlots;
export type PublicImageAsset = { id: string; url: string; width: number; height: number; mimeType: string; revision: number };
export type PhotoFrame = { fit: "contain" | "cover"; x: number; y: number; approvedAssetRevision: number | null };
export type PhotoBinding = { asset: PublicImageAsset; alt: { ko: string; en: string }; frames: Partial<Record<ImageSlot, PhotoFrame>>; revision: number };
/** null is an explicit removal: it must not revive old registered artwork. */
export type PhotoSet = Partial<Record<PhotoRole, PhotoBinding | null>>;
export type ImageRoleRecord = { role: PhotoRole; revision: number; binding: PhotoBinding | null };
export function photoSlots(owner: PhotoOwner, role: PhotoRole): ImageSlot[] {
  return (Object.keys(imageSlots) as ImageSlot[]).filter(slot => imageSlots[slot].role === role && (owner === "live" ? slot.startsWith("event.") : !slot.startsWith("event.")));
}
export function resolvePhoto(photos: PhotoSet | undefined, slot: ImageSlot, fallback: string, locale: "ko" | "en" = "ko") {
  const role = imageSlots[slot].role;
  const binding = photos?.[role];
  if (!binding) return { src: fallback, alt: undefined, fit: "contain" as const, position: "50% 50%", role, fallback: true };
  const frame = binding.frames[slot];
  const cover = frame?.fit === "cover" && frame.approvedAssetRevision === binding.asset.revision;
  return { src: binding.asset.url, alt: binding.alt[locale], fit: cover ? "cover" as const : "contain" as const,
    position: `${frame?.x ?? 50}% ${frame?.y ?? 50}%`, role, fallback: false };
}
