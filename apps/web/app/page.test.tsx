import { beforeEach, describe, expect, it, vi } from "vitest";

const repositories = vi.hoisted(() => ({
  listFeaturedPublished: vi.fn(),
  list: vi.fn(),
  listPrimaryLives: vi.fn(),
}));

vi.mock("../server/config/env", () => ({ loadServerEnv: () => ({ SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "secret" }) }));
vi.mock("../server/g3/live-event-repository", () => ({ createLiveEventRepositoryFromEnvironment: () => ({ listFeaturedPublished: repositories.listFeaturedPublished }) }));
vi.mock("../server/content/published-content-repository", () => ({ createPublishedContentRepositoryFromEnvironment: () => ({ list: repositories.list, listPrimaryLives: repositories.listPrimaryLives }) }));

import HomePage from "./page";

describe("Home server content isolation", () => {
  beforeEach(() => {
    repositories.listFeaturedPublished.mockReset().mockResolvedValue([]);
    repositories.list.mockReset().mockResolvedValue([]);
    repositories.listPrimaryLives.mockReset().mockResolvedValue([]);
  });

  it("keeps successful creator content when LIVE loading fails", async () => {
    repositories.listFeaturedPublished.mockRejectedValue(new Error("live unavailable"));
    const result = await HomePage({ searchParams: Promise.resolve({ locale: "en" }) });
    expect(result.props).toMatchObject({ locale: "en", celebrities: [], featuredLives: [], contentErrors: { featuredLives: true } });
  });

  it("marks creator LIVE metadata failure separately from an empty metadata result", async () => {
    repositories.listPrimaryLives.mockRejectedValue(new Error("metadata unavailable"));
    const result = await HomePage({ searchParams: Promise.resolve({}) });
    expect(result.props.contentErrors).toMatchObject({ celebrityLives: true });
  });

  it("uses the existing route error boundary when both main lists fail", async () => {
    repositories.listFeaturedPublished.mockRejectedValue(new Error("live unavailable"));
    repositories.list.mockRejectedValue(new Error("creators unavailable"));
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Home content unavailable");
  });
});
