import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicQuizIntroHandler } from "./public-quiz-intro-route";

const intro = {
  celebrity: { slug: "kara", name: "KARA" },
  quiz: { availability: "unavailable" as const, totalQuestions: 3 as const, passThreshold: 2 as const },
};

describe("GET /api/public/celebrities/[slug]/quiz", () => {
  it("returns an unavailable bank as a cacheable successful public state", async () => {
    const findBySlug = vi.fn().mockResolvedValue(intro);
    const response = await createPublicQuizIntroHandler({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/kara/quiz?locale=ko"),
      { slug: "kara" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    expect(await response.json()).toEqual({ intro });
    expect(findBySlug).toHaveBeenCalledWith({ slug: "kara", locale: "ko" });
  });

  it("uses a stable 404 for malformed, unknown, and unpublished celebrity slugs", async () => {
    const findBySlug = vi.fn().mockResolvedValue(null);
    const handler = createPublicQuizIntroHandler({ findBySlug });

    const malformed = await handler(
      new Request("https://byus.kr/api/public/celebrities/KARA/quiz"),
      { slug: "KARA" },
    );
    const missing = await handler(
      new Request("https://byus.kr/api/public/celebrities/hidden/quiz"),
      { slug: "hidden" },
    );

    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: "content_not_found" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "content_not_found" });
    expect(findBySlug).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported locale without querying Supabase", async () => {
    const findBySlug = vi.fn();
    const response = await createPublicQuizIntroHandler({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/kara/quiz?locale=ja"),
      { slug: "kara" },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_locale" });
    expect(findBySlug).not.toHaveBeenCalled();
  });

  it("fails closed without leaking repository details", async () => {
    const response = await createPublicQuizIntroHandler({
      findBySlug: vi.fn().mockRejectedValue(new Error("service role key secret")),
    })(new Request("https://byus.kr/api/public/celebrities/kara/quiz"), { slug: "kara" });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "content_unavailable" });
  });
});
