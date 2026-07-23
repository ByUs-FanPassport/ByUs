import { NextResponse } from "next/server";

import { parseContentLocale } from "../../../../server/content/content-domain";
import {
  createPublishedContentRepositoryFromEnvironment,
  type PublishedContentRepository,
} from "../../../../server/content/published-content-repository";
import { publicContentCacheHeaders } from "../../../../server/cache/public-content-cache";

export function createGetPublishedCelebrities(
  repository: Pick<PublishedContentRepository, "list" | "listPrimaryLives">,
) {
  return async function GET(request: Request): Promise<Response> {
    let locale;
    try {
      locale = parseContentLocale(
        new URL(request.url).searchParams.get("locale") ?? "ko",
      );
    } catch {
      return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
    }

    try {
      const [celebrities, primaryLives] = await Promise.all([
        repository.list(locale),
        repository.listPrimaryLives(locale),
      ]);
      return NextResponse.json(
        { celebrities, primaryLives },
        { status: 200, headers: publicContentCacheHeaders() },
      );
    } catch {
      return NextResponse.json(
        { error: "content_unavailable" },
        { status: 503 },
      );
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
