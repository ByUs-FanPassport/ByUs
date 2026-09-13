import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), project: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("../../../worker/src/action-public-snapshot", () => ({ readFinalizedActionSnapshot: mocks.read }));
vi.mock("./public-aggregate", () => ({ projectPublicOnchainSnapshot: mocks.project }));
import { getPublicOnchainResult } from "./public-snapshot";
import { onchainConfig } from "./public-config";
afterEach(() => { vi.clearAllMocks(); });
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
