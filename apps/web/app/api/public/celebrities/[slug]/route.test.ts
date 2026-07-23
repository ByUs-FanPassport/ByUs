import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGetPublishedCelebrity } from "./route";

const celebrity = {
  slug: "kara",
  locale: "en" as const,
  name: "KARA",
  summary: "Published profile",
  image: { url: "/kara.jpg", alt: "KARA", position: "center" },
  themes: [],
  socialLinks: [],
  displayOrder: 0,
};

function context(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /api/public/celebrities/[slug]", () => {
  it("returns one safe requested-locale projection", async () => {
    const findBySlug = vi.fn().mockResolvedValue(celebrity);
    const response = await createGetPublishedCelebrity({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/kara?locale=en"),
      context("kara"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vercel-cache-tag")).toBe("byus-public-content");
    expect(await response.json()).toEqual({ celebrity });
    expect(findBySlug).toHaveBeenCalledWith("en", "kara");
  });

  it("uses one non-enumerating 404 for an absent published projection", async () => {
    const findBySlug = vi.fn().mockResolvedValue(null);
    const response = await createGetPublishedCelebrity({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/hidden"),
      context("hidden"),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("rejects invalid locale or slug without querying the repository", async () => {
    const findBySlug = vi.fn();
    const invalidLocale = await createGetPublishedCelebrity({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/kara?locale=ja"),
      context("kara"),
    );
    const invalidSlug = await createGetPublishedCelebrity({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/KARA"),
      context("KARA"),
    );
    expect(invalidLocale.status).toBe(400);
    expect(invalidSlug.status).toBe(400);
    expect(findBySlug).not.toHaveBeenCalled();
  });

  it("redacts repository errors", async () => {
    const findBySlug = vi.fn().mockRejectedValue(new Error("secret key"));
    const response = await createGetPublishedCelebrity({ findBySlug })(
      new Request("https://byus.kr/api/public/celebrities/kara"),
      context("kara"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "content_unavailable" });
  });
});
