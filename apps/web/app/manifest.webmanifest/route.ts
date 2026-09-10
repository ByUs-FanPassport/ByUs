import { NextRequest } from "next/server";
import { createManifest } from "../../components/pwa-manifest";

export function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "ko";
  return Response.json(createManifest(locale), {
    headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" },
  });
}
