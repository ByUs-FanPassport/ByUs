import { beforeEach, describe, expect, it, vi } from "vitest";

const repositories = vi.hoisted(() => ({
  listFeaturedPublished: vi.fn(),
  list: vi.fn(),
  listPrimaryLives: vi.fn(),
  guidePhotos: vi.fn(),
}));

vi.mock("../server/config/env", () => ({ loadServerEnv: () => ({ SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "secret" }) }));
vi.mock("../server/g3/live-event-repository", () => ({ createLiveEventRepositoryFromEnvironment: () => ({ listFeaturedPublished: repositories.listFeaturedPublished }) }));
vi.mock("../server/content/published-content-repository", () => ({ createPublishedContentRepositoryFromEnvironment: () => ({ list: repositories.list, listPrimaryLives: repositories.listPrimaryLives }) }));

import HomePage from "./page";

describe("Home server content isolation", () => {
  beforeEach(() => {
    repositories.guidePhotos.mockReset().mockResolvedValue(undefined);
    repositories.listFeaturedPublished.mockReset().mockResolvedValue([]);
    repositories.list.mockReset().mockResolvedValue([]);
    repositories.listPrimaryLives.mockReset().mockResolvedValue([]);
  });

  it("keeps successful creator content when LIVE loading fails", async () => {
    repositories.listFeaturedPublished.mockRejectedValue(new Error("live unavailable"));
    const result = await HomePage({ searchParams: Promise.resolve({ locale: "en" }) });
    expect(result.props.children[1].props).toMatchObject({ locale: "en", celebrities: [], featuredLives: [], contentErrors: { featuredLives: true } });
  });

  it("marks creator LIVE metadata failure separately from an empty metadata result", async () => {
    repositories.listPrimaryLives.mockRejectedValue(new Error("metadata unavailable"));
    const result = await HomePage({ searchParams: Promise.resolve({}) });
    expect(result.props.children[1].props.contentErrors).toMatchObject({ celebrityLives: true });
  });

  it("isolates a failed guide role read without falling back to stale artwork", async () => {
    repositories.guidePhotos.mockRejectedValue(new Error("images unavailable"));
    const result = await HomePage({ searchParams: Promise.resolve({}) });
    expect(result.props.children[1].props.contentErrors.guideImages).toBe(true);
    expect(result.props.children[1].props.celebrities).toEqual([]);
  });

  it.each([
    [{}, undefined, "all"],
    [{ role: "all" }, false, "all"],
    [{ role: "creator" }, false, "creator"],
    [{ owned: "1" }, true, "all"],
    [{ owned: "0" }, false, "all"],
  ] as const)("distinguishes automatic defaults from explicit URL filters %j", async (query, initialOwnedOnly, initialRole) => {
    const result = await HomePage({ searchParams: Promise.resolve(query) });
    expect(result.props.children[1].props).toMatchObject({ initialOwnedOnly, initialRole });
  });

  it("uses the existing route error boundary when both main lists fail", async () => {
    repositories.listFeaturedPublished.mockRejectedValue(new Error("live unavailable"));
    repositories.list.mockRejectedValue(new Error("creators unavailable"));
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Home content unavailable");
  });
});

vi.mock("../server/media/guide-images", () => ({ loadGuideEventPhotos: repositories.guidePhotos }));
