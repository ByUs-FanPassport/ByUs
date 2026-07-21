import { NextResponse } from "next/server";

import { parseContentLocale } from "../../../../server/content/content-domain";
import {
  createPublishedContentRepositoryFromEnvironment,
  type PublishedContentRepository,
} from "../../../../server/content/published-content-repository";

const CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export function createGetPublishedCelebrities(repository: PublishedContentRepository) {
  return async function GET(request: Request): Promise<Response> {
    let locale;
    try {
      locale = parseContentLocale(new URL(request.url).searchParams.get("locale") ?? "ko");
    } catch {
      return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
    }

    try {
      const celebrities = await repository.list(locale);
      return NextResponse.json(
        { celebrities },
        { status: 200, headers: { "Cache-Control": CACHE_CONTROL } },
      );
    } catch {
      return NextResponse.json({ error: "content_unavailable" }, { status: 503 });
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const repository = createPublishedContentRepositoryFromEnvironment();
    return createGetPublishedCelebrities(repository)(request);
  } catch {
    return NextResponse.json({ error: "content_unavailable" }, { status: 503 });
  }
}
