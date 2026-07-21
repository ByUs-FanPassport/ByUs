import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabasePublicQuizIntroRepository } from "./public-quiz-intro-repository";

const intro = {
  celebrity: { slug: "kara", name: "KARA" },
  quiz: { availability: "available", totalQuestions: 3, passThreshold: 2 },
};

describe("SupabasePublicQuizIntroRepository", () => {
  it("uses only the fixed minimal RPC and parses its answer-free projection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: intro, error: null });
    const repository = new SupabasePublicQuizIntroRepository({ rpc });

    await expect(repository.findBySlug({ slug: "kara", locale: "ko" })).resolves.toEqual(intro);
    expect(rpc).toHaveBeenCalledWith("get_published_quiz_intro", {
      p_slug: "kara",
      p_locale: "ko",
    });
  });

  it("returns null only for an unknown or unpublished celebrity", async () => {
    const repository = new SupabasePublicQuizIntroRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(repository.findBySlug({ slug: "hidden", locale: "en" })).resolves.toBeNull();
  });

  it("fails closed on RPC and malformed projection errors", async () => {
    const failed = new SupabasePublicQuizIntroRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "secret detail" } }),
    });
    await expect(failed.findBySlug({ slug: "kara", locale: "ko" })).rejects.toThrow(
      "Public quiz intro query failed",
    );

    const malformed = new SupabasePublicQuizIntroRepository({
      rpc: vi.fn().mockResolvedValue({
        data: { ...intro, questions: [{ is_correct: true }] },
        error: null,
      }),
    });
    await expect(malformed.findBySlug({ slug: "kara", locale: "ko" })).rejects.toThrow(
      "Public quiz intro projection is invalid",
    );
  });
});
