import "server-only";
import { cache } from "react";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";
import { createLiveEventRepositoryFromEnvironment } from "@/server/g3/live-event-repository";
import type { SeoLocale } from "@/seo/metadata";

// Request-scoped only: anonymous content is shared between metadata and page,
// never between users or across a publication change.
export const loadSeoCreator = cache(async (slug: string, locale: SeoLocale) =>
  createPublishedContentRepositoryFromEnvironment().findBySlug(locale, slug));

export const loadSeoLive = cache(async (slug: string, locale: SeoLocale) => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Public LIVE is not configured");
  return createLiveEventRepositoryFromEnvironment({ url, serviceRoleKey })
    .findPublishedBySlug({ slug, locale, appUserId: null, now: new Date() });
});
