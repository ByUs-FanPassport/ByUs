import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../features/auth/domain/auth-errors";

const { authorize, listAdmin, save, state, upload } = vi.hoisted(() => ({
  authorize: vi.fn(), listAdmin: vi.fn(), save: vi.fn(), state: vi.fn(), upload: vi.fn(),
}));
vi.mock("./notice-dependencies", () => ({
  createNoticeDependencies: () => ({ authorize, repository: { listAdmin, save, state, upload } }),
}));
import { GET, POST } from "../../app/api/admin/celebrities/[id]/notices/route";
import { POST as uploadAsset } from "../../app/api/admin/celebrities/[id]/notices/[noticeId]/assets/route";

const id = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id, noticeId: id }) };
const request = () => new Request("https://byus.test/api/admin/notices");
const internalDetail = "Database failed: private_table credential=fixture-secret";

beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({ appUserId: id, allowlistId: id, role: "admin" });
  listAdmin.mockResolvedValue({ notices: [] });
});

describe("Notice admin API security", () => {
  it("never serializes repository error details", async () => {
    listAdmin.mockRejectedValue(new Error(internalDetail));
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({ error: "NOTICE_ADMIN_ERROR", message: "Notice request failed" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  });

  it("never serializes asset dependency errors", async () => {
    authorize.mockRejectedValue(new Error(internalDetail));
    const response = await uploadAsset(request(), context);
    expect(await response.json()).toEqual({ error: "NOTICE_ASSET_ERROR", message: "Upload failed" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("marks successful private admin reads non-cacheable", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects unauthenticated reads before repository access", async () => {
    authorize.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, internalDetail));
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(listAdmin).not.toHaveBeenCalled();
  });

  it("rejects viewer mutations before reading a body or calling storage", async () => {
    authorize.mockResolvedValue({ appUserId: id, allowlistId: id, role: "viewer" });
    const response = await POST(new Request(request(), { method: "POST", body: "invalid-json" }), context);
    const asset = await uploadAsset(request(), context);
    expect(response.status).toBe(403);
    expect(asset.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});
