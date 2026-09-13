import { z } from "zod";
import { safeAssetUrlSchema } from "../../live/domain/live-event";

export const bannerLocaleSchema = z.enum(["ko", "en"]);
export const bannerKindSchema = z.enum(["regular_live", "announcement"]);

export function isBannerHref(value: string): boolean {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://byus.kr");
    return !url.username && !url.password && (value.startsWith("/") || (/^https:\/\//i.test(value) && url.protocol === "https:"));
  } catch { return false; }
}

export function localizedBannerHref(href: string, locale: "ko" | "en"): string {
  if (!isBannerHref(href)) throw new Error("Invalid banner link");
  if (!href.startsWith("/")) return href;
  const url = new URL(href, "https://byus.kr");
  url.searchParams.set("locale", locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

const assetSchema = z.object({
  id: z.uuid(), url: safeAssetUrlSchema, width: z.number().int().positive(), height: z.number().int().positive(),
  mimeType: z.string(), revision: z.number().int().positive(),
}).strict();
const copyFields = {
  title: z.string().trim().max(160), description: z.string().trim().max(600),
  ctaLabel: z.string().trim().max(80), href: z.string().trim().max(2048).refine(v => !v || isBannerHref(v), "INVALID_LINK"),
  alt: z.string().trim().max(300),
};
export const bannerLocalizationSchema = z.object({
  ...copyFields, desktopImage: assetSchema.nullable(), mobileImage: assetSchema.nullable(),
}).strict();
const writeLocalizationSchema = z.object({
  ...copyFields, desktopAssetId: z.uuid().nullable(), mobileAssetId: z.uuid().nullable(),
}).strict();
export const adminHomeBannerSchema = z.object({
  id: z.uuid(), kind: bannerKindSchema, celebrityId: z.uuid().nullable(),
  publicationStatus: z.enum(["draft", "published"]), sortOrder: z.number().int(), revision: z.number().int().positive(),
  localizations: z.object({ ko: bannerLocalizationSchema, en: bannerLocalizationSchema }).strict(),
}).strict();
export const homeBannerManagerDataSchema = z.object({
  items: z.array(adminHomeBannerSchema),
  celebrities: z.array(z.object({ id: z.uuid(), slug: z.string(), nameKo: z.string(), nameEn: z.string() }).strict()),
}).strict();
export const homeBannerSchema = z.object({
  id: z.uuid(), kind: bannerKindSchema, celebrityId: z.uuid().nullable(),
  title: z.string().trim().min(1).max(160), description: copyFields.description,
  ctaLabel: z.string().trim().min(1).max(80), href: z.string().max(2048).refine(isBannerHref),
  alt: z.string().trim().min(1).max(300), desktopImage: assetSchema, mobileImage: assetSchema.nullable(),
}).strict();
export const homeBannerCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"), id: z.uuid().nullable(), expectedRevision: z.number().int().min(0),
    kind: bannerKindSchema, celebrityId: z.uuid().nullable(),
    localizations: z.object({ ko: writeLocalizationSchema, en: writeLocalizationSchema }).strict(),
  }).strict().refine(v => v.kind !== "regular_live" || v.celebrityId !== null, "CREATOR_REQUIRED")
    .refine(v => v.id !== null || v.expectedRevision === 0, "INVALID_REVISION"),
  z.object({ action: z.literal("publication"), id: z.uuid(), expectedRevision: z.number().int().positive(), publicationStatus: z.enum(["draft", "published"]) }).strict(),
  z.object({ action: z.literal("reorder"), items: z.array(z.object({ id: z.uuid(), expectedRevision: z.number().int().positive() }).strict()).max(500) }).strict()
    .refine(v => new Set(v.items.map(i => i.id)).size === v.items.length, "DUPLICATE_BANNER"),
]);
export type HomeBanner = z.infer<typeof homeBannerSchema>;
export type AdminHomeBanner = z.infer<typeof adminHomeBannerSchema>;
export type HomeBannerManagerData = z.infer<typeof homeBannerManagerDataSchema>;
export type HomeBannerCommand = z.infer<typeof homeBannerCommandSchema>;
export type BannerLocalization = z.infer<typeof bannerLocalizationSchema>;

export function bannerPublicationIssues(banner: Pick<AdminHomeBanner, "kind" | "celebrityId" | "localizations">): string[] {
  const issues: string[] = [];
  if (banner.kind === "regular_live" && !banner.celebrityId) issues.push("celebrityId");
  for (const locale of ["ko", "en"] as const) {
    const row = banner.localizations[locale];
    for (const field of ["title", "ctaLabel", "alt"] as const) if (!row[field].trim()) issues.push(`${locale}.${field}`);
    if (!isBannerHref(row.href)) issues.push(`${locale}.href`);
    if (!row.desktopImage) issues.push(`${locale}.desktopImage`);
  }
  return issues;
}
