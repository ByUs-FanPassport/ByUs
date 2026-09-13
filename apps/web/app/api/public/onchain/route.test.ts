import { expect, it, vi } from "vitest";
const getResult = vi.hoisted(() => vi.fn());
vi.mock("@/server/onchain/public-snapshot", () => ({ getPublicOnchainResult: getResult }));
import { GET } from "./route";
it("returns unavailable with 503 rather than publishing zero metrics", async () => {
  getResult.mockResolvedValue({ state: "unavailable" });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ state: "unavailable" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("returns the fixed verified snapshot without accepting caller parameters", async () => {
  getResult.mockResolvedValue({ state: "available", snapshot: { blockNumber: "123" } });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "available", snapshot: { blockNumber: "123" } });
});
