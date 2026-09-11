import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createAdminDirectoryHandlers } from "./admin-directory-route";
import { AdminDirectoryRepositoryError } from "./admin-directory-repository";
import { authorizeAdminSession, type AdminSessionRepository } from "./admin-session-gate";

const id = "10000000-0000-4000-8000-000000000001";
const actor = { appUserId: id, allowlistId: id, email: "owner@byus.test", role: "admin" as const };
const entry = { id, email: "new@byus.test", role: "viewer", active: true, createdAt: "2026-09-11T00:00:00.123456+00:00", updatedAt: "2026-09-11T00:00:00.123456+00:00" };
const repository = { read: vi.fn(), create: vi.fn(), update: vi.fn() };
const authorize = vi.fn();
function request(method = "GET", body?: unknown, raw?: string) {
  return new Request("http://localhost/api/admin/administrators", {
    method, headers: { authorization: "Bearer private-token", "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }),
  });
}
const handlers = createAdminDirectoryHandlers({ authorize, repository });
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue(actor);
  repository.read.mockResolvedValue({ items: [entry], actorId: id });
  repository.create.mockResolvedValue(entry);
  repository.update.mockResolvedValue(entry);
});
describe("admin directory HTTP boundary", () => {
  it("returns the directory only after authorization, with private non-cacheable responses", async () => {
    const response = await handlers.GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(await response.json()).toEqual({ items: [entry], actorId: id });
    expect(repository.read).toHaveBeenCalledWith(actor);
  });
  it.each(["operator", "viewer"])("denies %s on every operation before accessing data", async (role) => {
    authorize.mockResolvedValue({ ...actor, role });
    for (const method of ["GET", "POST", "PATCH"] as const) {
      const response = await handlers[method](request(method, {}));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    }
    for (const fn of Object.values(repository)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([401, 403] as const)("fails closed with %s on gate rejection", async (status) => {
    authorize.mockRejectedValue(new AuthError("ADMIN_DISABLED", status, "private identity details"));
    const response = await handlers.GET(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private identity details");
    expect(repository.read).not.toHaveBeenCalled();
  });
  it("normalizes email and defaults new access to viewer without accepting a client actor", async () => {
    expect((await handlers.POST(request("POST", { email: " New@ByUs.Test " }))).status).toBe(201);
    expect(repository.create).toHaveBeenCalledWith(actor, { email: "new@byus.test", role: "viewer" }, expect.any(String));
    const unauthorizedFields = await handlers.POST(request("POST", { email: "new@byus.test", role: "admin", appUserId: id }));
    expect(unauthorizedFields.status).toBe(400);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });
  it("passes access revocation and timestamp precision through to the database", async () => {
    const body = { id, role: "viewer", active: false, expectedUpdatedAt: entry.updatedAt };
    expect((await handlers.PATCH(request("PATCH", body))).status).toBe(200);
    expect(repository.update).toHaveBeenCalledWith(actor, body, expect.any(String));
  });
  it.each([
    {}, { email: "bad" }, { email: "x@byus.test", role: "root" }, { email: "x@byus.test", active: true },
  ])("rejects invalid create payload %j", async (body) => {
    expect((await handlers.POST(request("POST", body))).status).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each([
    { id, role: "admin", active: "false", expectedUpdatedAt: entry.updatedAt },
    { id, role: "admin", active: false },
    { id, role: "admin", active: false, expectedUpdatedAt: entry.updatedAt, email: "other@byus.test" },
  ])("rejects invalid updates %j", async (body) => {
    expect((await handlers.PATCH(request("PATCH", body))).status).toBe(400);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each(["{broken", "x".repeat(4097)])("rejects malformed or oversized bodies", async (raw) => {
    expect((await handlers.POST(request("POST", undefined, raw))).status).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each([
    ["ADMIN_DIRECTORY_FORBIDDEN", 403], ["ADMIN_DIRECTORY_DUPLICATE_EMAIL", 409],
    ["ADMIN_DIRECTORY_SELF_CHANGE", 409], ["ADMIN_DIRECTORY_LAST_ADMIN", 409],
    ["ADMIN_DIRECTORY_NOT_FOUND", 404], ["ADMIN_DIRECTORY_CONFLICT", 409],
    ["ADMIN_DIRECTORY_INVALID_INPUT", 400], ["ADMIN_DIRECTORY_UNAVAILABLE", 503],
  ] as const)("maps database rejection %s to %s", async (code, status) => {
    repository.update.mockRejectedValue(new AdminDirectoryRepositoryError(code));
    const response = await handlers.PATCH(request("PATCH", { id, role: "viewer", active: false, expectedUpdatedAt: entry.updatedAt }));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not expose raw provider or database failures", async () => {
    repository.read.mockRejectedValue(new Error("postgres detail: private@byus.test secret"));
    const response = await handlers.GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "ADMIN_DIRECTORY_UNAVAILABLE" } });
  });
  it("rechecks access on the next request with the same already-issued token", async () => {
    const adminEntry = { id, email: actor.email, role: "admin" as const, active: true };
    const gateRepository: AdminSessionRepository = {
      findUserByPrivyId: vi.fn().mockResolvedValue({ id, privyUserId: "did:privy:owner", verifiedEmail: actor.email, status: "active" }),
      findActiveAdminByEmail: vi.fn().mockImplementation(async () => adminEntry.active ? { ...adminEntry } : null),
      appendAuthorizationAudit: vi.fn().mockResolvedValue(undefined),
    };
    const verifier = { verify: vi.fn().mockResolvedValue({ privyUserId: "did:privy:owner", verifiedEmail: actor.email, googleLinked: true }) };
    const liveGate = createAdminDirectoryHandlers({ repository, authorize: (input) => authorizeAdminSession({ ...input, verifier, repository: gateRepository }) });
    expect((await liveGate.GET(request())).status).toBe(200);
    adminEntry.active = false;
    expect((await liveGate.GET(request())).status).toBe(403);
    expect(repository.read).toHaveBeenCalledTimes(1);
  });
});
