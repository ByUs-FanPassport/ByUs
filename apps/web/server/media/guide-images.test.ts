import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findBySlug: vi.fn(), readLivePhotoSetsBySlug: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../content/published-content-repository", () => ({ createPublishedContentRepositoryFromEnvironment: () => ({ findBySlug: mocks.findBySlug }) }));
vi.mock("./public-image-reader", () => ({ createPublicImageRoleReader: () => ({ readLivePhotoSetsBySlug: mocks.readLivePhotoSetsBySlug }) }));
import { loadGuideImages } from "./guide-images";
import { ifewLiveSlug } from "../../components/ifew-fan-guide/content";

describe("guide public image loading", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://db.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    mocks.findBySlug.mockReset();
    mocks.readLivePhotoSetsBySlug.mockReset();
  });
  it("loads the exact published creator and event roles, including explicit removal", async () => {
    const celebrity = { slug: "ifewknow", image: { url: "/old.jpg", photos: { profile: null, portrait: null } } };
    mocks.findBySlug.mockResolvedValue(celebrity);
    mocks.readLivePhotoSetsBySlug.mockResolvedValue({ [ifewLiveSlug]: { poster: null } });
    expect(await loadGuideImages("en", "ifew")).toEqual({ celebrity, eventPhotos: { poster: null } });
    expect(mocks.findBySlug).toHaveBeenCalledWith("en", "ifewknow");
    expect(mocks.readLivePhotoSetsBySlug).toHaveBeenCalledWith([ifewLiveSlug]);
  });
  it("does not revive a non-public creator with a fixed guide portrait", async () => {
    mocks.findBySlug.mockResolvedValue(null);
    expect(await loadGuideImages("ko", "elina")).toEqual({ celebrity: null, eventPhotos: undefined });
    expect(mocks.readLivePhotoSetsBySlug).not.toHaveBeenCalled();
  });
  it("surfaces role read errors rather than treating them as an unconfigured role", async () => {
    mocks.findBySlug.mockResolvedValue(null);
    mocks.readLivePhotoSetsBySlug.mockRejectedValue(new Error("role read unavailable"));
    await expect(loadGuideImages("ko", "ifew")).rejects.toThrow("role read unavailable");
  });
});
