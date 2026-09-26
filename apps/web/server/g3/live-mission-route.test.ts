import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createGetLiveMissionsHandler, createPostLiveMissionHandler } from "./live-mission-route";
import { SupabaseLiveMissionRepository } from "./live-mission-repository";
const rpc = vi.fn();
const repository = new SupabaseLiveMissionRepository({ rpc } as never);
it("preserves auth status and rejects malformed input before the reward RPC", async () => {
  const denied = createGetLiveMissionsHandler({ repository, authorize: async () => { throw new AuthError("AUTHENTICATION_REQUIRED",401,"invalid"); } });
  expect((await denied(new Request("https://byus.test/api"), { slug: "event" })).status).toBe(401);
  const submit = createPostLiveMissionHandler({ repository, authorize: async () => ({ appUserId: "owner" }) });
  expect((await submit(new Request("https://byus.test/api", { method: "POST", body: "{}" }), { missionId: "10000000-0000-4000-8000-000000000001" })).status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});
