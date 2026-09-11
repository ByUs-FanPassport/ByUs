import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabasePublicImageRoleReader } from "./public-image-reader";

const asset = { id: "11111111-1111-4111-8111-111111111111", url: "https://example.com/photo.webp", width: 1000, height: 1000, mimeType: "image/webp", revision: 1 };
const record = { role: "profile", revision: 2, binding: { asset, alt: { ko: "프로필", en: "Profile" }, frames: {}, revision: 2 } };

describe("public image role reader", () => {
  it("returns slug-keyed exact PhotoSets and skips a query for empty input", async () => {
    const rpc = vi.fn(async () => ({ data: [{ ownerSlug: "creator-a", record }], error: null }));
    const reader = new SupabasePublicImageRoleReader({ rpc } as never);
    await expect(reader.readCelebrityPhotoSetsBySlug(["creator-a", "creator-a"])).resolves.toEqual({ "creator-a": { profile: record.binding } });
    expect(rpc).toHaveBeenCalledWith("read_published_public_image_roles", { p_owner_type: "celebrity", p_slugs: ["creator-a"] });
    rpc.mockClear(); await expect(reader.readLivePhotoSetsBySlug([])).resolves.toEqual({}); expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on malformed or duplicate role rows", async () => {
    const duplicate = vi.fn(async () => ({ data: [{ ownerSlug: "creator-a", record }, { ownerSlug: "creator-a", record }], error: null }));
    await expect(new SupabasePublicImageRoleReader({ rpc: duplicate } as never).readCelebrityPhotoSetsBySlug(["creator-a"]))
      .rejects.toThrow("duplicate public image role");
    const malformed = vi.fn(async () => ({ data: [{ ownerSlug: "creator-a", record: { ...record, revision: 3 } }], error: null }));
    await expect(new SupabasePublicImageRoleReader({ rpc: malformed } as never).readCelebrityPhotoSetsBySlug(["creator-a"]))
      .rejects.toThrow();
  });
});
