import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseKakaoConnectionRepository } from "./kakao-connection-repository";

it("persists only hashed state/subject and never OAuth tokens", async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: { codeVerifier: "v".repeat(64), returnPath: "/settings", purpose: "connection", consentVersion: null }, error: null })
    .mockResolvedValueOnce({ data: { provider: "kakao", status: "connected", connectedAt: "2026-09-04T00:00:00.000Z", disconnectedAt: null }, error: null });
  const repo = new SupabaseKakaoConnectionRepository({ rpc });
  await repo.createState({ appUserId: "owner", stateHash: "a".repeat(64), codeVerifier: "v".repeat(64), returnPath: "/settings" });
  await repo.consumeState({ appUserId: "owner", stateHash: "a".repeat(64) });
  await repo.complete({ appUserId: "owner", subjectHash: "b".repeat(64) });
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/access[_-]?token|refresh[_-]?token/i);
});

it("normalizes only the exact legacy connection-state shape", async () => {
  const base = { codeVerifier: "v".repeat(64), returnPath: "/settings" };
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: base, error: null })
    .mockResolvedValueOnce({ data: { ...base, purpose: "connection" }, error: null })
    .mockResolvedValueOnce({ data: { ...base, purpose: "unexpected", consentVersion: null }, error: null });
  const repo = new SupabaseKakaoConnectionRepository({ rpc });

  await expect(repo.consumeState({ appUserId: "owner", stateHash: "a".repeat(64) })).resolves.toEqual({
    ...base,
    purpose: "connection",
    consentVersion: null,
  });
  await expect(repo.consumeState({ appUserId: "owner", stateHash: "b".repeat(64) })).rejects.toThrow("Kakao connection state is invalid");
  await expect(repo.consumeState({ appUserId: "owner", stateHash: "c".repeat(64) })).rejects.toThrow("Kakao connection state is invalid");
});
