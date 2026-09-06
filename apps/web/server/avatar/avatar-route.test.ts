import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { AvatarRepositoryError } from "./avatar-repository";
import {
  createDeleteAvatarHandler,
  createGetAvatarHandler,
  createGetAvatarImageHandler,
  createImportGoogleAvatarHandler,
  createPatchAvatarHandler,
  createPutAvatarHandler,
  withAvatarRouteDefaults,
  type AvatarRouteDependencies,
} from "./avatar-route";

const appUserId = "11111111-1111-4111-8111-111111111111";
const avatar = {
  initialCharacterId: "star-cream" as const,
  characterId: "star-cream" as const,
  source: "default" as const,
  hasImage: false,
  revision: 0,
};

function dependencies(overrides: Partial<AvatarRouteDependencies> = {}) {
  const repository = {
    ensure: vi.fn().mockResolvedValue(avatar),
    selectCharacter: vi.fn().mockResolvedValue({ ...avatar, characterId: "heart-pink", source: "character", revision: 1 }),
    replaceImage: vi.fn().mockResolvedValue({ ...avatar, source: "upload", hasImage: true, revision: 1 }),
    remove: vi.fn().mockResolvedValue({ ...avatar, source: "removed", revision: 1 }),
    image: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2]).buffer, contentType: "image/webp" }),
  };
  const result = withAvatarRouteDefaults({
    authorize: vi.fn().mockResolvedValue({ appUserId }),
    repository,
    getVerifiedGoogleSubject: vi.fn().mockResolvedValue("google-1"),
    normalizeImage: vi.fn().mockResolvedValue(new Uint8Array([7, 8])),
    fetchGoogleUserInfo: vi.fn().mockResolvedValue({ sub: "google-1", picture: "https://lh3.googleusercontent.com/a/p" }),
    fetchGoogleImage: vi.fn().mockResolvedValue(new Uint8Array([3, 4])),
    parseUpload: vi.fn().mockResolvedValue({
      file: {
        type: "image/png",
        size: 3,
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      },
      crop: { x: 0.1, y: 0.2, size: 0.5 },
      expectedRevision: 0,
    }),
    ...overrides,
  });
  return { dependencies: result, repository };
}

const request = (url: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { authorization: "Bearer privy-token", ...init.headers },
  });

describe("authenticated avatar routes", () => {
  it("GET lazily ensures avatar state independent of nickname completion", async () => {
    const { dependencies: deps, repository } = dependencies();
    const response = await createGetAvatarHandler(deps)(request("https://byus.test/api/me/avatar"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ avatar });
    expect(repository.ensure).toHaveBeenCalledWith(appUserId);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires the existing fan-auth owner gate", async () => {
    const { dependencies: deps } = dependencies({
      authorize: vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "required")),
    });
    const response = await createGetAvatarHandler(deps)(request("https://byus.test/api/me/avatar"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });

  it("PATCH accepts only a catalog character with an integer CAS revision", async () => {
    const { dependencies: deps, repository } = dependencies();
    const valid = await createPatchAvatarHandler(deps)(
      request("https://byus.test/api/me/avatar", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: "heart-pink", expectedRevision: 0 }),
      }),
    );
    expect(valid.status).toBe(200);
    expect(repository.selectCharacter).toHaveBeenCalledWith({
      appUserId,
      characterId: "heart-pink",
      expectedRevision: 0,
    });

    const invalid = await createPatchAvatarHandler(deps)(
      request("https://byus.test/api/me/avatar", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: "custom-url", expectedRevision: 0 }),
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("maps stale PATCH and DELETE revisions to 409", async () => {
    const { dependencies: deps } = dependencies();
    deps.repository.selectCharacter = vi.fn().mockRejectedValue(new AvatarRepositoryError("STALE_REVISION"));
    deps.repository.remove = vi.fn().mockRejectedValue(new AvatarRepositoryError("STALE_REVISION"));
    const patch = await createPatchAvatarHandler(deps)(request("https://byus.test/api/me/avatar", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "ghost-cream", expectedRevision: 4 }),
    }));
    const remove = await createDeleteAvatarHandler(deps)(request("https://byus.test/api/me/avatar", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4 }),
    }));
    expect(patch.status).toBe(409);
    expect(remove.status).toBe(409);
  });

  it("PUT parses one bounded multipart file, crop, and expected revision", async () => {
    const { dependencies: deps, repository } = dependencies();
    const response = await createPutAvatarHandler(deps)(request("https://byus.test/api/me/avatar", {
      method: "PUT",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new Uint8Array([1]).buffer,
    }));
    expect(response.status).toBe(200);
    expect(deps.normalizeImage).toHaveBeenCalledWith(expect.any(Uint8Array), { x: 0.1, y: 0.2, size: 0.5 });
    expect(repository.replaceImage).toHaveBeenCalledWith({
      appUserId,
      source: "upload",
      expectedRevision: 0,
      bytes: new Uint8Array([7, 8]),
    });
  });

  it("PUT rejects unapproved MIME types before image decoding", async () => {
    const { dependencies: deps } = dependencies();
    deps.parseUpload = vi.fn().mockResolvedValue({
      file: { type: "image/svg+xml", size: 3, arrayBuffer: vi.fn() },
      crop: { x: 0, y: 0, size: 1 },
      expectedRevision: 0,
    });
    const response = await createPutAvatarHandler(deps)(request("https://byus.test/api/me/avatar", {
      method: "PUT",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new Uint8Array([1]).buffer,
    }));
    expect(response.status).toBe(415);
    expect(deps.normalizeImage).not.toHaveBeenCalled();
  });

  it("image GET serves binary only for the requested revision and maps stale to 409", async () => {
    const { dependencies: deps } = dependencies();
    const response = await createGetAvatarImageHandler(deps)(
      request("https://byus.test/api/me/avatar/image?revision=0"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    deps.repository.image = vi.fn().mockRejectedValue(new AvatarRepositoryError("STALE_REVISION"));
    expect(
      (await createGetAvatarImageHandler(deps)(request("https://byus.test/api/me/avatar/image?revision=1"))).status,
    ).toBe(409);
  });

  it("Google import requires an exact verified linked subject and imports only default source", async () => {
    const { dependencies: deps, repository } = dependencies();
    const importRequest = () => request("https://byus.test/api/me/avatar/import-google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "google-token" }),
    });
    const response = await createImportGoogleAvatarHandler(deps)(importRequest());
    expect(response.status).toBe(200);
    expect(deps.getVerifiedGoogleSubject).toHaveBeenCalledWith("Bearer privy-token");
    expect(repository.replaceImage).toHaveBeenCalledWith({
      appUserId,
      source: "google",
      expectedRevision: 0,
      bytes: new Uint8Array([7, 8]),
    });

    deps.fetchGoogleUserInfo = vi.fn().mockResolvedValue({ sub: "attacker", picture: "https://lh3.googleusercontent.com/a/p" });
    expect((await createImportGoogleAvatarHandler(deps)(importRequest())).status).toBe(403);

    repository.ensure.mockResolvedValueOnce({ ...avatar, source: "character", revision: 2 });
    deps.fetchGoogleUserInfo = vi.fn();
    expect((await createImportGoogleAvatarHandler(deps)(importRequest())).status).toBe(200);
    expect(deps.fetchGoogleUserInfo).not.toHaveBeenCalled();
  });

  it("keeps the current avatar when Google profile, image, decode, or CAS import fails", async () => {
    const { dependencies: deps, repository } = dependencies({
      fetchGoogleUserInfo: vi.fn().mockResolvedValue(null),
    });
    const response = await createImportGoogleAvatarHandler(deps)(request("https://byus.test/api/me/avatar/import-google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "expired" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ avatar });
    expect(repository.replaceImage).not.toHaveBeenCalled();
  });
});
