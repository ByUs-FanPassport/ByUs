import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), project: vi.fn(), cache: vi.fn((fn: () => unknown, _keys: string[], _options: unknown) => fn) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: mocks.cache }));
vi.mock("../../../worker/src/action-public-snapshot", () => ({ readFinalizedActionSnapshot: mocks.read }));
vi.mock("./public-aggregate", () => ({ projectPublicOnchainSnapshot: mocks.project }));
import { getPublicOnchainResult } from "./public-snapshot";
import { onchainConfig } from "./public-config";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
it("fails closed on an RPC or attestation validation failure", async () => {
  mocks.read.mockRejectedValue(new Error("private diagnostic payload"));
  expect(await getPublicOnchainResult()).toEqual({ state: "unavailable" });
});
it("does not present an old cached result as current", async () => {
  mocks.read.mockResolvedValue({});
  mocks.project.mockReturnValue({ generatedAt: "2020-01-01T00:00:00Z" });
  expect(await getPublicOnchainResult()).toEqual({ state: "unavailable" });
});
it("coalesces concurrent reads and uses only the fixed public deployment", async () => {
  mocks.read.mockResolvedValue({});
  mocks.project.mockReturnValue({ generatedAt: new Date().toISOString() });
  const results = await Promise.all([getPublicOnchainResult(), getPublicOnchainResult()]);
  expect(results.every((result) => result.state === "available")).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledWith(onchainConfig);
});

it("uses a server-only read RPC without changing deployment identities or exposing its key", async () => {
  vi.stubEnv("GIWA_PUBLIC_READ_RPC_URL", "https://giwa-sepolia.nodit.io/private-read-key");
  vi.resetModules();
  const { getPublicOnchainResult: readWithPrivateRpc } = await import("./public-snapshot");
  mocks.read.mockResolvedValue({});
  mocks.project.mockReturnValue({ generatedAt: new Date().toISOString() });
  const result = await readWithPrivateRpc();
  expect(mocks.read).toHaveBeenCalledWith({ ...onchainConfig, rpcUrl: "https://giwa-sepolia.nodit.io/private-read-key" });
  expect(JSON.stringify(result)).not.toContain("private-read-key");
  expect(JSON.stringify(mocks.cache.mock.calls.at(-1)?.[1])).not.toContain("private-read-key");
});

it("caches a full large ledger without dropping records or exceeding the storage budget", async () => {
  vi.resetModules();
  const { getPublicOnchainResult: readLargeSnapshot } = await import("./public-snapshot");
  const snapshot = { generatedAt: new Date().toISOString(), actions: Array.from({ length: 1200 }, (_,index) => ({ actionId: index, proof: "x".repeat(1300) })) };
  mocks.read.mockResolvedValue({});
  mocks.project.mockReturnValue(snapshot);
  expect(await readLargeSnapshot()).toEqual({ state: "available", snapshot });
  const stored = await mocks.cache.mock.calls.at(-1)![0]();
  expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(512_000);
});
