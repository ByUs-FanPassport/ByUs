import { beforeEach, describe, expect, it, vi } from "vitest";

import QuizEntryPage from "./page";
import QuizQuestionsPage from "./questions/page";
import QuizResultPage from "./result/page";

const { findBySlug } = vi.hoisted(() => ({ findBySlug: vi.fn() }));

vi.mock("../../../../server/content/published-content-repository", () => ({
  createPublishedContentRepositoryFromEnvironment: () => ({ findBySlug }),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  useRouter: () => ({ push: vi.fn() }),
}));

describe("fan verification route locale contract", () => {
  beforeEach(() => {
    findBySlug.mockReset();
    findBySlug.mockResolvedValue({ name: "KATSEYE" });
  });

  it("threads the English locale and entity slug into the entry screen", async () => {
    const element = await QuizEntryPage({
      params: Promise.resolve({ slug: "katseye" }),
      searchParams: Promise.resolve({ locale: "en" }),
    });

    expect(element.props).toMatchObject({ locale: "en", slug: "katseye" });
  });

  it("threads the English locale and entity slug into the questions screen", async () => {
    const element = await QuizQuestionsPage({
      params: Promise.resolve({ slug: "katseye" }),
      searchParams: Promise.resolve({ locale: "en" }),
    });

    expect(element.props).toMatchObject({ locale: "en", slug: "katseye" });
  });

  it("uses the locale for the published entity and threads it into the result screen", async () => {
    const attemptId = "10000000-0000-4000-8000-000000000001";
    const passportId = "20000000-0000-4000-8000-000000000002";
    const element = await QuizResultPage({
      params: Promise.resolve({ slug: "katseye" }),
      searchParams: Promise.resolve({
        attempt: attemptId,
        passport: passportId,
        locale: "en",
      }),
    });

    expect(findBySlug).toHaveBeenCalledWith("en", "katseye");
    expect(element.props).toMatchObject({
      attemptId,
      passportId,
      celebritySlug: "katseye",
      celebrityName: "KATSEYE",
      locale: "en",
    });
  });

  it.each([
    { locale: undefined },
    { locale: "ja" },
    { locale: ["en"] },
  ])("defaults unsupported entry locale input to Korean: %j", async (searchParams) => {
    const element = await QuizEntryPage({
      params: Promise.resolve({ slug: "katseye" }),
      searchParams: Promise.resolve(searchParams),
    });

    expect(element.props.locale).toBe("ko");
  });
});
