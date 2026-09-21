import { parseAppLocale } from "@/i18n/locales";
import { NextRequest } from "next/server";
import { createManifest } from "../../components/pwa-manifest";

export function GET(request: NextRequest) {
  const locale = parseAppLocale(request.nextUrl.searchParams.get("locale"));
  return Response.json(createManifest(locale), {
    headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" },
  });
}
