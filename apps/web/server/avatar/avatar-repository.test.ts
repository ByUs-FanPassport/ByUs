import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AvatarRepositoryError, SupabaseAvatarRepository } from "./avatar-repository";

const userId = "11111111-1111-4111-8111-111111111111";
const generatedId = "22222222-2222-4222-8222-222222222222";
const rawAvatar = (overrides: Record<string, unknown> = {}) => ({
  initialCharacterId: "star-cream",
  characterId: "heart-pink",
  source: "upload",
  hasImage: true,
  revision: 2,
  objectPath: `${userId}/2-${generatedId}.webp`,
  previousObjectPath: null,
  ...overrides,
});

function client() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const download = vi.fn().mockResolvedValue({
    data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    error: null,
  });
  return {
    rpc: vi.fn().mockResolvedValue({ data: rawAvatar(), error: null }),
    storage: { from: vi.fn(() => ({ upload, remove, download })) },
    upload,
    remove,
    download,
  };
}

describe("avatar repository CAS and private object lifecycle", () => {
  it("lazily ensures one owner-scoped avatar through the service RPC", async () => {
    const db = client();
    db.rpc.mockResolvedValueOnce({
      data: rawAvatar({ source: "default", hasImage: false, revision: 0, objectPath: null }),
      error: null,
    });
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    await expect(repository.ensure(userId)).resolves.toMatchObject({
      initialCharacterId: "star-cream",
      source: "default",
      revision: 0,
    });
    expect(db.rpc).toHaveBeenCalledWith("ensure_owned_avatar", { p_app_user_id: userId });
  });

  it("uploads to an immutable key, commits CAS, then deletes only the previous object", async () => {
    const db = client();
    const previous = `${userId}/1-33333333-3333-4333-8333-333333333333.webp`;
    db.rpc.mockResolvedValueOnce({
      data: rawAvatar({ previousObjectPath: previous }),
      error: null,
    });
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    const bytes = new Uint8Array([8, 9]);
    await repository.replaceImage({ appUserId: userId, source: "upload", expectedRevision: 1, bytes });
    const next = `${userId}/2-${generatedId}.webp`;
    expect(db.upload).toHaveBeenCalledWith(next, bytes, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000",
    });
    expect(db.rpc).toHaveBeenCalledWith("set_owned_avatar_image", {
      p_app_user_id: userId,
      p_source: "upload",
      p_object_path: next,
      p_expected_revision: 1,
    });
    expect(db.remove).toHaveBeenCalledWith([previous]);
  });

  it("deletes its own new object and preserves the previous object when CAS loses", async () => {
    const db = client();
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "AVATAR_STALE_REVISION" } });
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    const next = `${userId}/2-${generatedId}.webp`;
    await expect(
      repository.replaceImage({
        appUserId: userId,
        source: "google",
        expectedRevision: 1,
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(db.remove).toHaveBeenCalledTimes(1);
    expect(db.remove).toHaveBeenCalledWith([next]);
  });

  it("preserves a candidate when an ambiguous response may follow a committed mutation", async () => {
    const db = client();
    const next = `${userId}/2-${generatedId}.webp`;
    db.rpc
      .mockResolvedValueOnce({ data: { malformed: true }, error: null })
      .mockResolvedValueOnce({
        data: rawAvatar({ objectPath: next, previousObjectPath: null }),
        error: null,
      });
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    await expect(
      repository.replaceImage({
        appUserId: userId,
        source: "upload",
        expectedRevision: 1,
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ revision: 2, hasImage: true });
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("preserves an unreferenced candidate while ambiguous state remains at the expected revision", async () => {
    const db = client();
    db.rpc
      .mockResolvedValueOnce({ data: { malformed: true }, error: null })
      .mockResolvedValueOnce({
        data: rawAvatar({
          source: "character",
          hasImage: false,
          revision: 1,
          objectPath: null,
          previousObjectPath: null,
        }),
        error: null,
      });
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    await expect(
      repository.replaceImage({
        appUserId: userId,
        source: "upload",
        expectedRevision: 1,
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: "AVATAR_UNAVAILABLE" });
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("does not turn a committed avatar mutation into failure when old-object cleanup rejects", async () => {
    const db = client();
    const previous = `${userId}/1-33333333-3333-4333-8333-333333333333.webp`;
    db.rpc.mockResolvedValueOnce({
      data: rawAvatar({ previousObjectPath: previous }),
      error: null,
    });
    db.remove.mockRejectedValueOnce(new Error("storage unavailable"));
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    await expect(
      repository.replaceImage({
        appUserId: userId,
        source: "upload",
        expectedRevision: 1,
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ revision: 2 });
  });

  it("deletes the replaced object after character selection and removal", async () => {
    const db = client();
    const previous = `${userId}/2-${generatedId}.webp`;
    db.rpc
      .mockResolvedValueOnce({
        data: rawAvatar({ source: "character", hasImage: false, revision: 3, objectPath: null, previousObjectPath: previous }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: rawAvatar({ source: "removed", hasImage: false, revision: 4, objectPath: null, previousObjectPath: null }),
        error: null,
      });
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    await repository.selectCharacter({ appUserId: userId, characterId: "fairy-lavender", expectedRevision: 2 });
    await repository.remove({ appUserId: userId, expectedRevision: 3 });
    expect(db.remove).toHaveBeenCalledTimes(1);
    expect(db.remove).toHaveBeenCalledWith([previous]);
  });

  it("serves only the object belonging to the requested current revision", async () => {
    const db = client();
    const repository = new SupabaseAvatarRepository(db as never, () => generatedId);
    await expect(repository.image(userId, 1)).rejects.toEqual(
      new AvatarRepositoryError("STALE_REVISION"),
    );
    expect(db.download).not.toHaveBeenCalled();

    await expect(repository.image(userId, 2)).resolves.toMatchObject({ contentType: "image/webp" });
    expect(db.download).toHaveBeenCalledWith(`${userId}/2-${generatedId}.webp`);
  });
});
