import type { MetadataRoute } from "next";
import { loadSitemapContent } from "@/server/seo/sitemap-content";
import { buildSitemap } from "@/seo/sitemap";

// Query on each request so draft/unpublish changes disappear without a redeploy.
// A failed read must fail the response, never publish a misleading partial sitemap.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(await loadSitemapContent());
}
