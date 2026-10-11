import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creator: { roles: ["brand"] as string[] },
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));

vi.mock("@/server/seo/public-content", () => ({ loadSeoCreator: vi.fn(async () => mocks.creator) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("not-found"); }), redirect: mocks.redirect }));
vi.mock("../../../../features/quiz/ui/quiz-entry-screen", () => ({ QuizEntryScreen: () => <div>Quiz</div> }));

import QuizEntryPage from "./page";

describe("brand fan verification route", () => {
  it("redirects a published brand to its public home", async () => {
    await expect(QuizEntryPage({ params: Promise.resolve({ slug: "runmusic" }), searchParams: Promise.resolve({ locale: "en" }) }))
      .rejects.toThrow("redirect:/runmusic?locale=en");
  });
});
