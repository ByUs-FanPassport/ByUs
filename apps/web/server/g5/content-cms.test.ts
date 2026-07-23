import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { celebrityPayload, ContentCmsRepository, quizPayload } = await import("./content-cms");

const actor = {
  email: "admin@example.com",
  role: "operator" as const,
  appUserId: "11111111-1111-4111-8111-111111111111",
  allowlistId: "22222222-2222-4222-8222-222222222222",
};

describe("content CMS", () => {
  it("requires complete KO and EN celebrity content", () => {
    expect(() =>
      celebrityPayload.parse({
        slug: "kara",
        imageUrl: "/kara.jpg",
        imagePosition: "center",
        displayOrder: 0,
        fanCount: 12_800_000,
        localizations: {
          ko: { name: "카라", summary: "소개", imageAlt: "카라" },
        },
        themes: [],
        socialLinks: [],
      }),
    ).toThrow();
  });

  it("accepts an omitted draft fan count but rejects invalid fan counts", () => {
    const base = {
      slug: "kara",
      imageUrl: "/kara.jpg",
      imagePosition: "center",
      displayOrder: 0,
      localizations: {
        ko: { name: "카라", summary: "소개", imageAlt: "카라" },
        en: { name: "KARA", summary: "Profile", imageAlt: "KARA" },
      },
      themes: [],
      socialLinks: [],
    };
    expect(celebrityPayload.parse({ ...base, fanCount: null }).fanCount).toBeNull();
    expect(() => celebrityPayload.parse({ ...base, fanCount: -1 })).toThrow();
    expect(() => celebrityPayload.parse({ ...base, fanCount: 1.5 })).toThrow();
    expect(() => celebrityPayload.parse({ ...base, fanCount: "12800000" })).toThrow();
  });

  it("requires exactly four options and one correct answer", () => {
    const base = {
      position: 1,
      promptKo: "질문",
      promptEn: "Question",
      active: true,
    };
    expect(() =>
      quizPayload.parse({
        quizId: null,
        questions: [
          {
            ...base,
            options: [1, 2, 3].map((position) => ({
              position,
              labelKo: "답",
              labelEn: "Answer",
              isCorrect: position === 1,
              active: true,
            })),
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      quizPayload.parse({
        quizId: null,
        questions: [
          {
            ...base,
            options: [1, 2, 3, 4].map((position) => ({
              position,
              labelKo: "답",
              labelEn: "Answer",
              isCorrect: true,
              active: true,
            })),
          },
        ],
      }),
    ).toThrow();
  });

  it("passes actor and correlation to the atomic clone RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = new ContentCmsRepository({ rpc } as never);
    await repository.quizCommand(
      actor,
      "33333333-3333-4333-8333-333333333333",
      "55555555-5555-4555-8555-555555555555",
      "clone",
      "44444444-4444-4444-8444-444444444444",
    );
    expect(rpc).toHaveBeenCalledWith("clone_admin_quiz_version", {
      p_actor: actor.allowlistId,
      p_correlation: "33333333-3333-4333-8333-333333333333",
      p_celebrity: "55555555-5555-4555-8555-555555555555",
      p_quiz: "44444444-4444-4444-8444-444444444444",
    });
  });
});
