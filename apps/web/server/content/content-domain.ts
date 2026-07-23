import { z } from "zod";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a canonical lowercase slug");

const localeSchema = z.enum(["ko", "en"]);
const httpsOrRootRelativeUrl = z.string().refine((value) => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "must be a root-relative path or HTTPS URL");

const httpsUrl = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "must be an HTTPS URL");

const themeSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
});

const socialLinkSchema = z.object({
  platform: z.enum(["youtube", "tiktok", "instagram"]),
  url: httpsUrl,
});

const publishedCelebrityRowSchema = z.object({
  slug: slugSchema,
  locale: localeSchema,
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
  image_url: httpsOrRootRelativeUrl,
  image_alt: z.string().trim().min(1).max(300),
  image_position: z.string().trim().min(1).max(100),
  themes: z.array(themeSchema),
  social_links: z.array(socialLinkSchema),
  display_order: z.number().int().min(0),
  fan_count: z.number().int().min(0),
});

const publishedCelebrityLiveRowSchema = z.object({
  slug: slugSchema,
  celebrity_slug: slugSchema,
  locale: localeSchema,
  title: z.string().trim().min(1).max(160),
  starts_at: z.string().datetime({ offset: true }),
  effective_status: z.enum(["scheduled", "live"]),
});

export type ContentLocale = z.infer<typeof localeSchema>;
export type PublishedCelebritySlug = z.infer<typeof slugSchema>;

export type PublishedCelebrity = Readonly<{
  slug: string;
  locale: ContentLocale;
  name: string;
  summary: string;
  image: Readonly<{ url: string; alt: string; position: string }>;
  themes: readonly Readonly<{ slug: string; name: string }>[];
  socialLinks: readonly Readonly<{
    platform: "youtube" | "tiktok" | "instagram";
    url: string;
  }>[];
  displayOrder: number;
  fanCount: number;
}>;

export type PublishedCelebrityLive = Readonly<{
  slug: string;
  celebritySlug: string;
  locale: ContentLocale;
  title: string;
  startsAt: string;
  effectiveStatus: "scheduled" | "live";
}>;

export function parsePublishedCelebritySlug(value: unknown): PublishedCelebritySlug {
  return slugSchema.parse(value);
}

export function parseContentLocale(value: unknown): ContentLocale {
  return localeSchema.parse(value);
}

export function parsePublishedCelebrity(value: unknown): PublishedCelebrity {
  const row = publishedCelebrityRowSchema.parse(value);
  return {
    slug: row.slug,
    locale: row.locale,
    name: row.name,
    summary: row.summary,
    image: { url: row.image_url, alt: row.image_alt, position: row.image_position },
    themes: row.themes,
    socialLinks: row.social_links,
    displayOrder: row.display_order,
    fanCount: row.fan_count,
  };
}

export function parsePublishedCelebrityLive(
  value: unknown,
): PublishedCelebrityLive {
  const row = publishedCelebrityLiveRowSchema.parse(value);
  return {
    slug: row.slug,
    celebritySlug: row.celebrity_slug,
    locale: row.locale,
    title: row.title,
    startsAt: row.starts_at,
    effectiveStatus: row.effective_status,
  };
}
