import { imageSlots, resolvePhoto, type PhotoSet, type ImageSlot } from "../../features/media/domain/public-image";
import { legacyImageDimensions } from "./legacy-image-dimensions";
/** Creator photo sources and reviewed framing. Surfaces choose a presentation, never a crop. */
export const creatorPresentationSlots = {
  portrait: "identity.square", avatar: "identity.avatar", passport: "identity.passport",
  collection: "creator.collection", vertical: "creator.vertical", calendar: "creator.calendar",
  editorial: "creator.hero.mobile",
} as const satisfies Record<string, ImageSlot>;
export type CreatorImagePresentation = keyof typeof creatorPresentationSlots;
export function creatorPresentationRole(presentation: CreatorImagePresentation) {
  return imageSlots[creatorPresentationSlots[presentation]].role;
}

export const parkMyunghoProfile = "/images/celebrities/park-myungho/profile-20260910.png";

type Crop = Readonly<{ position: string; scale: number; origin: string; translateX?: string; fit?: "cover" | "contain" }>;
const neutralCrop: Crop = { position: "center", scale: 1, origin: "50% 50%" };
const parkCrop: Crop = { position: "50% 0%", scale: 2.3, origin: "56% 14%" };
const parkPresentations: Partial<Record<CreatorImagePresentation, Crop>> = {
  passport: { ...parkCrop, scale: 1.85 },
  collection: { ...parkCrop, scale: 1.5 },
  vertical: { ...parkCrop, scale: 3, origin: "56% 10%" },
  calendar: { ...parkCrop, scale: 2.8, origin: "56% 10%" },
};
const ifewCrop: Crop = { position: "center", scale: 2.45, origin: "48% 40%" };

/** Replace only the previous registered Park photo; a later CMS upload remains authoritative. */
function isPreviousParkSource(source: string | null | undefined) {
  return !source || source === parkMyunghoProfile || source === "/images/celebrities/park-myungho/hero-portrait.jpg"
    || /^https:\/\/(gmrykvmtmuaeswpajteq|xcppyedwusirqnfpbtit)\.supabase\.co\/storage\/v1\/object\/public\/cms-assets\/celebrities\/park-myungho\/profile-dcc87957756c27df\.jpg$/.test(source);
}

function isPreviousJennySource(source: string) {
  return calendarPortraits["jenny-jeong"]!.includes(source)
    || /^https:\/\/(gmrykvmtmuaeswpajteq|xcppyedwusirqnfpbtit)\.supabase\.co\/storage\/v1\/object\/public\/cms-assets\/celebrities\/jenny-jeong\/profile-88d6cd4994afe602\.jpg$/.test(source);
}

export function resolveCreatorImage({ slug, src, presentation = "portrait", position, photos }: {
  slug: string;
  src: string | null | undefined;
  presentation?: CreatorImagePresentation;
  position?: string;
  photos?: PhotoSet;
}): Readonly<{ src: string | null | undefined; crop: Crop }> {
  const slot = creatorPresentationSlots[presentation];
  const role = creatorPresentationRole(presentation);
  if (photos && Object.hasOwn(photos, role)) {
    const resolved = resolvePhoto(photos, slot, src ?? "");
    return { src: resolved.src, crop: { ...neutralCrop, fit: resolved.fit, position: resolved.position } };
  }
  if (role !== "profile") {
    if (presentation === "calendar") {
      const registered = src && calendarPortraits[slug]?.includes(src);
      return { src, crop: { ...neutralCrop, position: position ?? "50% 35%", fit: registered && slug !== "xin" ? "cover" : "contain" } };
    }
    const hero = resolveCreatorHeroImage(slug, { url: src ?? "", position: position ?? "50% 50%" });
    return role === "landscape"
      ? { src: hero?.src ?? src, crop: { ...neutralCrop, position: hero?.desktopPosition ?? "50% 50%", fit: hero?.desktopFit ?? "contain" } }
      : { src: hero?.mobileSrc ?? src, crop: { ...neutralCrop, position: hero?.mobilePosition ?? "50% 50%", fit: hero?.mobileFit ?? "contain" } };
  }
  const base = { ...neutralCrop, position: position ?? (presentation === "calendar" ? "center 35%" : "center") };
  if (slug === "park-myungho") {
    return isPreviousParkSource(src) ? { src: parkMyunghoProfile, crop: parkPresentations[presentation] ?? parkCrop } : { src, crop: base };
  }
  if (presentation === "calendar") return { src, crop: { ...base, fit: slug === "xin" || !calendarPortraits[slug] ? "contain" : "cover" } };
  if (presentation === "collection" || presentation === "vertical") return { src, crop: base };
  if (slug === "katseye" && presentation !== "portrait") return { src: "/images/celebrities/katseye/profile.webp", crop: base };
  if (slug === "xin") {
    return presentation === "portrait"
      ? { src, crop: { position: "50% 100%", scale: 1.6, origin: "50% 100%" } }
      : { src: "/images/celebrities/xin/hero-concept-mobile.jpg", crop: { ...base, position: "50% 30%" } };
  }
  if (slug === "ifewknow") return { src, crop: { ...ifewCrop, position: position ?? ifewCrop.position } };
  if (slug === "yuna") return { src, crop: presentation === "avatar"
    ? { position: "50% 0%", scale: .82, origin: "50% 50%", translateX: "-4%" }
    : { ...base, position: presentation === "passport" ? "50% 0%" : "50% 20%" } };
  return { src, crop: base };
}

/** The caller supplies the unzoomed display sizes; only this layer accounts for magnification. */
export function creatorImageSizes(sizes: string, scale: number) {
  if (scale <= 1) return sizes;
  return sizes.split(/,(?![^()]*\))/).map((part) => {
    const value = part.trim();
    const media = value.startsWith("(") ? value.slice(0, value.indexOf(")") + 1) : "";
    const size = value.slice(media.length).trim();
    const expression = size.startsWith("calc(") ? size.slice(5, -1) : size;
    // CSS length multiplication is distributed to remain valid in sizes across browsers.
    const scaled = expression.replace(/(\d*\.?\d+)(px|vw|vh|rem|em|%)/g, (_, number, unit) => `${Number((Number(number) * scale).toFixed(3))}${unit}`);
    const result = size.startsWith("calc(") ? `calc(${scaled})` : scaled;
    return media ? `${media} ${result}` : result;
  }).join(", ");
}

const calendarPortraits: Readonly<Record<string, readonly string[]>> = {
  elina: ["/images/celebrities/elina/hero-source.jpg", "/images/celebrities/elina/hero-beach.jpg", "/images/guest-home/elina-card.jpg"],
  changha: ["/images/celebrities/changha/hero-source.jpg", "/images/celebrities/changha/hero-mobile.jpg"],
  yuna: ["/images/celebrities/yuna/hero-studio-mobile.jpg", "/images/calendar/yuna-portrait.jpg"],
  xin: ["/images/celebrities/xin/hero-concept.jpg", "/images/calendar/xin-profile.jpg"],
  "jenny-jeong": ["/images/celebrities/jenny-jeong/hero-source.jpg", "/images/calendar/jenny-jeong-profile.jpg"],
  aryeom: ["/images/celebrities/aryeom/hero-portrait.jpg", "/images/calendar/aryeom-profile.jpg"],
  ifewknow: ["/images/celebrities/ifewknow/hero-studio.jpg"],
};

export function creatorCalendarPhotos(slug: string, src: string, photos?: PhotoSet) {
  if (photos && Object.hasOwn(photos, "portrait")) return [photos.portrait?.asset.url ?? src];
  if (slug === "jenny-jeong" && !isPreviousJennySource(src)) return [src];
  return calendarPortraits[slug] ?? [resolveCreatorImage({ slug, src }).src ?? src];
}

export function hasCreatorCalendarPhotos(slug: string) {
  return slug === "park-myungho" || Boolean(calendarPortraits[slug]);
}

/** Dedicated banner compositions, registered alongside the shared identity source. */
export type CreatorHeroImage = Readonly<{
  src: string;
  mobileSrc?: string;
  desktopFit?: "contain" | "cover";
  mobileFit?: "contain" | "cover";
  background?: string;
  desktopPosition: string;
  mobilePosition: string;
  mobileScale?: number;
  mobileOrigin?: string;
}>;

export const creatorHeroImages: Readonly<Record<string, CreatorHeroImage>> = {
  katseye: { src: "/images/celebrities/katseye/hero-desktop.webp", mobileSrc: "/images/celebrities/katseye/hero-mobile.webp", desktopPosition: "50% 50%", mobilePosition: "50% 50%" },
  "thisisj-official": { src: "/images/celebrities/thisisj-official/hero-source.webp", desktopPosition: "50% 28%", mobilePosition: "40% 35%" },
  kara: { src: "/images/guest-home/kara-card.jpg", desktopPosition: "50% 0%", mobilePosition: "50% 50%" },
  changha: { src: "/images/celebrities/changha/hero-source.jpg", mobileSrc: "/images/celebrities/changha/hero-mobile.jpg", desktopPosition: "50% 0%", mobilePosition: "50% 10%" },
  elina: { src: "/images/celebrities/elina/hero-beach.jpg", mobileSrc: "/images/celebrities/elina/hero-source.jpg", desktopPosition: "50% 25%", mobilePosition: "50% 100%" },
  yuna: { src: "/images/celebrities/yuna/hero-beach.jpg", mobileSrc: "/images/celebrities/yuna/hero-studio-mobile.jpg", background: "#ececec", desktopPosition: "50% 0%", mobilePosition: "50% 0%" },
  "jenny-jeong": { src: "/images/celebrities/jenny-jeong/hero-source.jpg", desktopPosition: "50% 25%", mobilePosition: "53% 25%" },
  xin: { src: "/images/celebrities/xin/hero-concept.jpg", mobileSrc: "/images/celebrities/xin/hero-concept-mobile.jpg", desktopPosition: "50% 15%", mobilePosition: "50% 25%" },
  aryeom: { src: "/images/celebrities/aryeom/hero-portrait.jpg", desktopFit: "contain", background: "#887b69", desktopPosition: "right center", mobilePosition: "50% 20%" },
  ifewknow: { src: "/images/celebrities/ifewknow/hero-studio.jpg", desktopPosition: "50% 45%", mobilePosition: "50% 70%" },
  "park-myungho": { src: parkMyunghoProfile, background: "#f6ead2", desktopPosition: "50% 0%", mobilePosition: "50% 0%", mobileScale: 2.3, mobileOrigin: "56% 14%" },
};

export function resolveCreatorHeroImage(slug: string, image: { url: string; position: string; photos?: PhotoSet }): CreatorHeroImage | undefined {
  const dedicated = creatorHeroImages[slug];
  const replaced = (slug === "park-myungho" && !isPreviousParkSource(image.url)) || (slug === "jenny-jeong" && !isPreviousJennySource(image.url));
  const legacy = replaced ? undefined : dedicated;
  const desktopSource = legacy?.src ?? image.url;
  const mobileSource = legacy?.mobileSrc ?? desktopSource;
  const desktopDimensions = legacyImageDimensions[desktopSource];
  const mobileDimensions = legacyImageDimensions[mobileSource];
  const desktop = resolvePhoto(image.photos, "creator.hero.desktop", image.photos?.landscape === null ? image.url : desktopSource);
  const mobile = resolvePhoto(image.photos, "creator.hero.mobile", image.photos?.portrait === null ? image.url : mobileSource);
  const desktopConfigured = image.photos && Object.hasOwn(image.photos, "landscape");
  const mobileConfigured = image.photos && Object.hasOwn(image.photos, "portrait");
  return {
    src: desktopConfigured ? desktop.src : desktopSource,
    mobileSrc: mobileConfigured ? mobile.src : mobileSource,
    desktopFit: desktopConfigured ? desktop.fit : legacy && desktopDimensions && desktopDimensions[0] / desktopDimensions[1] >= 1.4 ? legacy?.desktopFit ?? "cover" : "contain",
    mobileFit: mobileConfigured ? mobile.fit : legacy && mobileDimensions && mobileDimensions[0] / mobileDimensions[1] <= .9 ? "cover" : "contain",
    desktopPosition: desktopConfigured ? desktop.position : legacy?.desktopPosition ?? image.position,
    mobilePosition: mobileConfigured ? mobile.position : legacy?.mobilePosition ?? image.position,
    background: legacy?.background,
    mobileScale: 1,
  };
}
