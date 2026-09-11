import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PublicImageRepository } from "./public-image-repository";

const actor = { appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222", email: "admin@example.com", role: "admin" as const };
const asset = { id: "33333333-3333-4333-8333-333333333333", url: `https://project.supabase.co/storage/v1/object/public/cms-assets/public-image-assets/${"a".repeat(64)}.webp`, width: 440, height: 440, mimeType: "image/webp", revision: 1 };

describe("public image repository", () => {
  it("uploads a content-addressed immutable object without overwrite and registers metadata through the guarded RPC", async () => {
    const upload = vi.fn(async () => ({ data: { path: "stored" }, error: null }));
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: asset.url } }));
    const rpc = vi.fn(async () => ({ data: asset, error: null }));
    const repository = new PublicImageRepository({ storage: { from: vi.fn(() => ({ upload, getPublicUrl })) }, rpc } as never, "https://project.supabase.co");
    const image = { bytes: new Uint8Array([1, 2, 3]), width: 440, height: 440, mimeType: "image/webp" as const, sha256: "a".repeat(64) };
    await expect(repository.register(actor, "44444444-4444-4444-8444-444444444444", image)).resolves.toEqual(asset);
    expect(upload).toHaveBeenCalledWith(`public-image-assets/${"a".repeat(64)}.webp`, image.bytes, expect.objectContaining({ upsert: false }));
    expect(rpc).toHaveBeenCalledWith("register_admin_public_image_asset", expect.objectContaining({ p_actor_app_user_id: actor.appUserId, p_content_sha256: "a".repeat(64), p_byte_size: 3 }));
  });

  it("does not hide a non-duplicate storage failure behind metadata registration", async () => {
    const upload = vi.fn(async () => ({ data: null, error: { message: "storage unavailable", statusCode: 500 } }));
    const rpc = vi.fn();
    const repository = new PublicImageRepository({ storage: { from: vi.fn(() => ({ upload, getPublicUrl: vi.fn() })) }, rpc } as never, "https://project.supabase.co");
    await expect(repository.register(actor, crypto.randomUUID(), { bytes: new Uint8Array([1]), width: 1, height: 1, mimeType: "image/webp", sha256: "b".repeat(64) }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
