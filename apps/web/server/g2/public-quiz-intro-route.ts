import "server-only";

import { parseContentLocale, parsePublishedCelebritySlug } from "../content/content-domain";
import type { PublicQuizIntroRepository } from "./public-quiz-intro-repository";

export const PUBLIC_CONTENT_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": PUBLIC_CONTENT_CACHE_CONTROL },
  });
}

export function createPublicQuizIntroHandler(repository: PublicQuizIntroRepository) {
  return async function GET(
    request: Request,
    input: { slug: string },
  ): Promise<Response> {
    let slug: string;
    try {
      slug = parsePublishedCelebritySlug(input.slug);
    } catch {
      return json({ error: "content_not_found" }, 404);
    }

    let locale;
    try {
      locale = parseContentLocale(new URL(request.url).searchParams.get("locale") ?? "ko");
    } catch {
      return json({ error: "invalid_locale" }, 400);
    }

    try {
      const intro = await repository.findBySlug({ slug, locale });
      if (!intro) return json({ error: "content_not_found" }, 404);
      return json({ intro }, 200);
    } catch {
      return json({ error: "content_unavailable" }, 503);
    }
  };
}
