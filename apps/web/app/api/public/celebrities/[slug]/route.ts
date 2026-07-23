import { NextResponse } from "next/server";

import {
  parseContentLocale,
  parsePublishedCelebritySlug,
} from "../../../../../server/content/content-domain";
import {
  createPublishedContentRepositoryFromEnvironment,
  type PublishedContentRepository,
} from "../../../../../server/content/published-content-repository";
import { publicContentCacheHeaders } from "../../../../../server/cache/public-content-cache";

export function createGetPublishedCelebrity(
  repository: Pick<PublishedContentRepository, "findBySlug">,
) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ slug: string }> },
  ): Promise<Response> {
    let locale;
    let slug;
    try {
      locale = parseContentLocale(
        new URL(request.url).searchParams.get("locale") ?? "ko",
      );
      slug = parsePublishedCelebritySlug((await context.params).slug);
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    try {
      const celebrity = await repository.findBySlug(locale, slug);
      if (!celebrity) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json(
        { celebrity },
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

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    return createGetPublishedCelebrity(
      createPublishedContentRepositoryFromEnvironment(),
    )(request, context);
  } catch {
    return NextResponse.json({ error: "content_unavailable" }, { status: 503 });
  }
}
