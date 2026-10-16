import { afterEach, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { snapshotClient } from "../src/action-public-snapshot.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("paces log reads and bounded HTTP batches through the same request budget", async () => {
  vi.useFakeTimers();
  const sent: Array<{ at: number; methods: string[]; batch: boolean }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const requests = Array.isArray(body) ? body : [body];
    sent.push({ at: Date.now(), methods: requests.map((request) => request.method), batch: Array.isArray(body) });
    const replies = requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_getLogs" ? [] : "0x1" }));
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  }));
  const reader = snapshotClient({ chainId: 91342, rpcUrl: "https://rpc.example.test" }, new AbortController().signal);
  const result = Promise.all([
    ...Array.from({ length: 33 }, (_, index) => reader.getBalance({
      address: `0x${index.toString(16).padStart(40, "0")}` as Address,
    })),
    reader.getLogs({ fromBlock: 1n, toBlock: 1000n }),
    reader.getLogs({ fromBlock: 1001n, toBlock: 2000n }),
  ]);
  await vi.runAllTimersAsync();
  expect(await result).toEqual([...Array(33).fill(1n), [], []]);
  expect(sent.filter((request) => request.batch).map((request) => request.methods.length)).toEqual([16, 16, 1]);
  expect(sent.filter((request) => request.methods.includes("eth_getLogs"))).toEqual([
    expect.objectContaining({ batch: false, methods: ["eth_getLogs"] }),
    expect.objectContaining({ batch: false, methods: ["eth_getLogs"] }),
  ]);
  for (let index = 1; index < sent.length; index++) {
    const previous = sent[index - 1]!;
    const units = previous.methods.reduce((total, method) => total + (method === "eth_getLogs" ? 66 : 26), 0);
    expect(sent[index]!.at - previous.at).toBeGreaterThanOrEqual(Math.ceil(units / 2));
  }
});

it("sends no request after the snapshot deadline is aborted", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort(new Error("Snapshot stopped"));
  const reader = snapshotClient({ chainId: 91342, rpcUrl: "https://rpc.example.test" }, controller.signal);
  await expect(reader.getChainId()).rejects.toThrow("Snapshot stopped");
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])("bounds quota backoff even when the limit persists: %s", async (persistent) => {
  vi.useFakeTimers();
  const times: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    times.push(Date.now());
    return new Response(JSON.stringify(body.map((request: { id: number }) => ({ jsonrpc: "2.0", id: request.id,
      ...(persistent || times.length <= 2 ? { error: { code: 429, message: "too many requests" } } : { result: "0x164ce" }) }))));
  }));
  const reader = snapshotClient({ chainId: 91342, rpcUrl: "https://retry.example.test" }, new AbortController().signal);
  const result = reader.getChainId().then((chainId) => ({ chainId }), (error: Error) => ({ error }));
  await vi.runAllTimersAsync();
  expect(await result).toEqual(persistent ? { error: expect.any(Error) } : { chainId: 91342 });
  expect(times).toHaveLength(3);
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1_000);
  expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(2_000);
});

it("aborts quota backoff without waiting for a long Retry-After header", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => new Response("Too many requests", { status: 429, headers: { "Retry-After": "300" } }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const reader = snapshotClient({ chainId: 91342, rpcUrl: "https://abort.example.test" }, controller.signal);
  const result = reader.getChainId().then(() => "unexpected success", (error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(1);
  controller.abort(new Error("Snapshot deadline exceeded"));
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toContain("Snapshot deadline exceeded");
  expect(fetch).toHaveBeenCalledTimes(1);
});
