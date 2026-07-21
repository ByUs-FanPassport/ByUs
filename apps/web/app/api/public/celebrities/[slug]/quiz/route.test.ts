import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../server/g2/public-quiz-intro-repository", () => ({
  createPublicQuizIntroRepositoryFromEnvironment: () => {
    throw new Error("environment unavailable");
  },
}));

import { GET } from "./route";

describe("public quiz route bootstrap failure", () => {
  it("returns an uncacheable 503 without a public cache tag", async () => {
    const response = await GET(
      new Request("https://byus.test/api/public/celebrities/kara/quiz"),
      { params: Promise.resolve({ slug: "kara" }) },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vercel-cache-tag")).toBeNull();
  });
});
