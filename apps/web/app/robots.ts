import type { MetadataRoute } from "next";
import { SITE_URL } from "@/seo/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    // Pages with noindex remain crawlable so crawlers can see the directive.
    // No training-bot policy change; search/share bots follow this public rule.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/connect/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
