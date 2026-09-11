import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SeoLocale } from "@/seo/metadata";

export type IndexablePage = { path: string; locale: SeoLocale };

/** Select only public URL/locale fields; no viewer, attendance or recipient data. */
export async function loadSitemapContent(): Promise<IndexablePage[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Sitemap content is not configured");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const pages: IndexablePage[] = [];
  const pageSize = 500;
  for (const locale of ["ko", "en"] as const) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from("published_celebrities")
        .select("slug").eq("locale", locale).order("slug").range(offset, offset + pageSize - 1);
      if (error || !data) throw new Error("Sitemap creator query failed");
      pages.push(...data.map(({ slug }) => ({ path: `/c/${slug}`, locale })));
      if (data.length < pageSize) break;
    }
    for (let offset = 0; ; offset += pageSize) {
      // Match LIVE detail's published event, parent and translation predicates.
      // Include ended/cancelled events too: a stable public URL outlives its schedule.
      const { data, error } = await client.from("live_events")
        .select("slug, live_event_localizations!inner(locale), celebrities!inner(status, celebrity_localizations!inner(locale)), brands!inner(status, brand_localizations!inner(locale))")
        .eq("publication_status", "published")
        .eq("live_event_localizations.locale", locale)
        .eq("celebrities.status", "published").eq("celebrities.celebrity_localizations.locale", locale)
        .eq("brands.status", "published").eq("brands.brand_localizations.locale", locale)
        .order("slug").range(offset, offset + pageSize - 1);
      if (error || !data) throw new Error("Sitemap LIVE query failed");
      pages.push(...data.map(({ slug }) => ({ path: `/live/${slug}`, locale })));
      if (data.length < pageSize) break;
    }
  }
  return pages;
}
