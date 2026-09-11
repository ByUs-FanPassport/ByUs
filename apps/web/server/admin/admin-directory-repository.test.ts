import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { createAdminDirectoryRepository } from "./admin-directory-repository";

const id = "10000000-0000-4000-8000-000000000001";
const actor = { appUserId: id, allowlistId: id, email: "owner@byus.test", role: "admin" as const };
const item = { id, email: "owner@byus.test", role: "admin", active: true, createdAt: "2026-09-11T00:00:00.123456+00:00", updatedAt: "2026-09-11T00:00:00.123456+00:00" };
function setup(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, repo: createAdminDirectoryRepository({ url: "http://localhost", serviceRoleKey: "unused" }, { rpc } as unknown as Pick<SupabaseClient, "rpc">) };
}
describe("admin directory repository", () => {
  it("validates directory shape and preserves timestamp microseconds", async () => {
    const { repo, rpc } = setup({ items: [item], actorId: id });
    expect(await repo.read(actor)).toEqual({ items: [item], actorId: id });
    expect(rpc).toHaveBeenCalledWith("read_admin_directory", { p_actor_app_user_id: id, p_actor_admin_allowlist_id: id });
  });
  it("passes the authenticated actor, correlation, and raw optimistic version on writes", async () => {
    const { repo, rpc } = setup(item);
    await repo.create(actor, { email: "owner@byus.test", role: "admin" }, id);
    expect(rpc).toHaveBeenLastCalledWith("create_admin_directory_entry", { p_actor_app_user_id: id, p_actor_admin_allowlist_id: id, p_correlation_id: id, p_email: "owner@byus.test", p_role: "admin" });
    await repo.update(actor, { id, role: "viewer", active: false, expectedUpdatedAt: item.updatedAt }, id);
    expect(rpc).toHaveBeenLastCalledWith("update_admin_directory_entry", expect.objectContaining({ p_expected_updated_at: item.updatedAt, p_active: false, p_role: "viewer" }));
  });
  it("maps recognized application errors but conceals raw database messages", async () => {
    const expected = setup(null, { message: "ADMIN_DIRECTORY_DUPLICATE_EMAIL" });
    await expect(expected.repo.read(actor)).rejects.toMatchObject({ code: "ADMIN_DIRECTORY_DUPLICATE_EMAIL" });
    const unexpected = setup(null, { message: "duplicate key email=(private@byus.test)" });
    await expect(unexpected.repo.read(actor)).rejects.toMatchObject({ code: "ADMIN_DIRECTORY_UNAVAILABLE" });
  });
  it.each([null, { items: [{ ...item, role: "root" }], actorId: id }, { items: [item] }])("rejects invalid database output", async (data) => {
    await expect(setup(data).repo.read(actor)).rejects.toMatchObject({ code: "ADMIN_DIRECTORY_UNAVAILABLE" });
  });
});
