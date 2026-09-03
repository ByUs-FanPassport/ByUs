import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseKakaoConnectionRepository } from "./kakao-connection-repository";

it("persists only hashed state/subject and never OAuth tokens", async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: { codeVerifier: "v".repeat(64), returnPath: "/settings" }, error: null })
    .mockResolvedValueOnce({ data: { provider: "kakao", status: "connected", connectedAt: "2026-09-04T00:00:00.000Z", disconnectedAt: null }, error: null });
  const repo = new SupabaseKakaoConnectionRepository({ rpc });
  await repo.createState({ appUserId: "owner", stateHash: "a".repeat(64), codeVerifier: "v".repeat(64), returnPath: "/settings" });
  await repo.consumeState({ appUserId: "owner", stateHash: "a".repeat(64) });
  await repo.complete({ appUserId: "owner", subjectHash: "b".repeat(64) });
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/access[_-]?token|refresh[_-]?token/i);
});
