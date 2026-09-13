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

  it("reads a growing deduplicated roster in RPC chunks of at most 200", async () => {
    const slugs = Array.from({ length: 205 }, (_, index) => `creator-${index}`);
    const rpc = vi.fn(async (_name: string, args: { p_slugs: string[] }) => ({
      data: args.p_slugs.map((ownerSlug) => ({ ownerSlug, record })),
      error: null,
    }));
    const reader = new SupabasePublicImageRoleReader({ rpc } as never);

    const result = await reader.readCelebrityPhotoSetsBySlug([
      ...slugs,
      "creator-0",
      "creator-204",
    ]);

    expect(Object.keys(result)).toHaveLength(205);
    expect(result["creator-0"]).toEqual({ profile: record.binding });
    expect(result["creator-204"]).toEqual({ profile: record.binding });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => args.p_slugs.length)).toEqual([200, 5]);
    expect(rpc.mock.calls.flatMap(([, args]) => args.p_slugs)).toEqual(slugs);
  });

  it("validates the whole input before reading any chunk", async () => {
    const rpc = vi.fn();
    const reader = new SupabasePublicImageRoleReader({ rpc } as never);
    const slugs = [
      ...Array.from({ length: 200 }, (_, index) => `creator-${index}`),
      "Invalid-Slug",
    ];

    await expect(reader.readCelebrityPhotoSetsBySlug(slugs)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects the whole read when any chunk fails", async () => {
    const slugs = Array.from({ length: 201 }, (_, index) => `creator-${index}`);
    const rpc = vi.fn(async (_name: string, args: { p_slugs: string[] }) =>
      args.p_slugs[0] === "creator-200"
        ? { data: null, error: { message: "second chunk unavailable" } }
        : { data: args.p_slugs.map((ownerSlug) => ({ ownerSlug, record })), error: null },
    );
    const reader = new SupabasePublicImageRoleReader({ rpc } as never);

    await expect(reader.readCelebrityPhotoSetsBySlug(slugs))
      .rejects.toThrow("public image role read failed: second chunk unavailable");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
