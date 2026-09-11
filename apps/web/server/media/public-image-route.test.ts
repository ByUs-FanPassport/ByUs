import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { PublicImageError } from "./public-image-processing";
import { createImageRoleHandlers, createPostPublicImageAssetHandler, type PublicImageRouteDependencies } from "./public-image-route";

const actor = { appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222", email: "admin@example.com", role: "admin" as const };
function dependencies(overrides: Partial<PublicImageRouteDependencies> = {}): PublicImageRouteDependencies {
  return { authorize: vi.fn(async () => actor), repository: { listRoles: vi.fn(async () => []), setRole: vi.fn(), normalizeAndRegister: vi.fn(), downloadCurrentCmsAsset: vi.fn() } as never, invalidatePublicContent: vi.fn(), ...overrides };
}

describe("public image admin routes", () => {
  it("authenticates before parsing asset input", async () => {
    const repository = { normalizeAndRegister: vi.fn(), downloadCurrentCmsAsset: vi.fn() } as never;
    const handler = createPostPublicImageAssetHandler(dependencies({ repository, authorize: vi.fn(async () => { throw new AuthError("AUTHENTICATION_REQUIRED", 401, "required"); }) }));
    const response = await handler(new Request("https://byus.test/api/admin/image-assets", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" }));
    expect(response.status).toBe(401); expect((repository as { normalizeAndRegister: ReturnType<typeof vi.fn> }).normalizeAndRegister).not.toHaveBeenCalled();
  });

  it("rejects viewer writes before consuming the body", async () => {
    const handler = createPostPublicImageAssetHandler(dependencies({ authorize: vi.fn(async () => ({ ...actor, role: "viewer" as const })) }));
    const response = await handler(new Request("https://byus.test/api/admin/image-assets", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" }));
    expect(response.status).toBe(403);
  });

  it("maps CAS rejection to 409 and passes an exact validated role command", async () => {
    const setRole = vi.fn(async () => { throw new PublicImageError("CONFLICT"); });
    const invalidatePublicContent = vi.fn();
    const handlers = createImageRoleHandlers(dependencies({ repository: { setRole, listRoles: vi.fn() } as never, invalidatePublicContent }));
    const body = { ownerType: "celebrity", ownerId: actor.appUserId, role: "profile", expectedRevision: 0, binding: null };
    const response = await handlers.POST(new Request("https://byus.test/api/admin/image-roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(409); expect(setRole).toHaveBeenCalledWith(actor, expect.any(String), body); expect(invalidatePublicContent).not.toHaveBeenCalled();
  });

  it("invalidates public content only after a successful atomic apply", async () => {
    const item = { role: "profile", revision: 1, binding: null };
    const setRole = vi.fn(async () => item); const invalidatePublicContent = vi.fn();
    const handlers = createImageRoleHandlers(dependencies({ repository: { setRole, listRoles: vi.fn() } as never, invalidatePublicContent }));
    const response = await handlers.POST(new Request("https://byus.test/api/admin/image-roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerType: "celebrity", ownerId: actor.appUserId, role: "profile", expectedRevision: 0, binding: null }) }));
    expect(response.status).toBe(200); expect(invalidatePublicContent).toHaveBeenCalledOnce();
  });

  it("rejects cross-owner frames before the repository write", async () => {
    const setRole = vi.fn(); const handlers = createImageRoleHandlers(dependencies({ repository: { setRole, listRoles: vi.fn() } as never }));
    const response = await handlers.POST(new Request("https://byus.test/api/admin/image-roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      ownerType: "celebrity", ownerId: actor.appUserId, role: "profile", expectedRevision: 0,
      binding: { assetId: actor.allowlistId, alt: { ko: "프로필", en: "Profile" }, frames: { "event.poster": { fit: "cover", x: 50, y: 50, approvedAssetRevision: 1 } } },
    }) }));
    expect(response.status).toBe(400); expect(setRole).not.toHaveBeenCalled();
  });
});
