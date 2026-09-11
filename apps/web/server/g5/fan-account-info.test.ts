import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createFanProviderReader, withFanAccountInfo, type FanProviderClient } from "./fan-account-info";
import { FanOperationsRepositoryError, type FanOperationsRepository } from "./fan-operations-repository";
import { createGetFansHandler } from "./fan-operations-route";

afterEach(() => vi.useRealTimers());
const linked = (id: string) => ({ id, linked_accounts: [
  { type: "google_oauth", verified_at: 20, email: "private@example.com", subject: "private-subject", name: "Private Name" },
  { type: "apple_oauth", verified_at: 21 },
  { type: "email", verified_at: 22 },
  { type: "wallet", verified_at: 23 },
] });
function client(get: ReturnType<FanProviderClient["users"]>["_get"]): FanProviderClient { return { users: () => ({ _get: get }) }; }

describe("bounded provider lookup", () => {
  it("returns only verified provider enums and caches without private payloads", async () => {
    const get = vi.fn(async (id) => linked(id));
    const cache = new Map();
    const read = createFanProviderReader({ appId: "app1", client: client(get), cache });
    expect((await read(["owner1", "owner1"])).get("owner1")).toEqual(["google", "apple", "email"]);
    await read(["owner1"]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...cache.values()])).not.toMatch(/private|subject|email@|Name/);
    expect(get).toHaveBeenCalledWith("owner1", expect.objectContaining({ timeout: 2000, maxRetries: 0, signal: expect.any(AbortSignal) }));
  });
  it("separates apps and expires provider cache after five minutes", async () => {
    const get = vi.fn(async (id) => linked(id));
    const cache = new Map();
    let time = 0;
    const first = createFanProviderReader({ appId: "first", client: client(get), cache, now: () => time });
    const second = createFanProviderReader({ appId: "second", client: client(get), cache, now: () => time });
    await first(["owner"]); await second(["owner"]);
    expect(get).toHaveBeenCalledTimes(2);
    time = 299_999; await first(["owner"]);
    expect(get).toHaveBeenCalledTimes(2);
    time = 300_000; await first(["owner"]);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("bounds cache size and returns empty methods for an actually unlinked account", async () => {
    const cache = new Map();
    const get = vi.fn(async (id) => ({ id, linked_accounts: [{ type: "google_oauth", verified_at: 0 }, { type: "apple_oauth" }] }));
    const read = createFanProviderReader({ appId: "app", client: client(get), cache });
    const ids = Array.from({ length: 505 }, (_, i) => `owner${i}`);
    const result = await read(ids);
    expect(result.get("owner504")).toEqual([]);
    expect(cache.size).toBe(500);
    await read(["owner0"]);
    expect(get).toHaveBeenCalledTimes(506);
  });
  it("isolates upstream failures and rejects mismatched response identities without caching them", async () => {
    const get = vi.fn(async (id) => {
      if (id === "failed") throw new Error("private upstream payload");
      return linked(id === "mismatch" ? "wrong-user" : id);
    });
    const read = createFanProviderReader({ appId: "app", client: client(get), cache: new Map() });
    const result = await read(["ok", "failed", "mismatch"]);
    expect(result.get("ok")).toEqual(["google", "apple", "email"]);
    expect(result.get("failed")).toBeNull();
    expect(result.get("mismatch")).toBeNull();
    await read(["ok", "failed", "mismatch"]);
    expect(get).toHaveBeenCalledTimes(5);
  });
  it("limits concurrent requests to four while draining successful requests", async () => {
    vi.useFakeTimers();
    let active = 0, peak = 0;
    const get = vi.fn(async (id) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--; return linked(id);
    });
    const read = createFanProviderReader({ appId: "app", client: client(get), cache: new Map() });
    const done = read(Array.from({ length: 12 }, (_, i) => `owner${i}`));
    await vi.advanceTimersByTimeAsync(100);
    expect((await done).size).toBe(12);
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });
  it("aborts active requests at the overall deadline and never starts queued ones afterward", async () => {
    vi.useFakeTimers();
    let cancelled = 0;
    const get = vi.fn((_id, options) => new Promise<ReturnType<typeof linked>>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => { cancelled++; reject(new Error("aborted")); }, { once: true });
    }));
    const read = createFanProviderReader({ appId: "app", client: client(get), cache: new Map() });
    const done = read(Array.from({ length: 12 }, (_, i) => `owner${i}`));
    await vi.advanceTimersByTimeAsync(2500);
    const result = await done;
    expect(get).toHaveBeenCalledTimes(4);
    expect(cancelled).toBe(4);
    expect([...result.values()].every((value) => value === null)).toBe(true);
  });
});

const fanId = "11111111-1111-4111-8111-111111111111";
const actor = { appUserId: "22222222-2222-4222-8222-222222222222", allowlistId: "33333333-3333-4333-8333-333333333333" };
const listInput = { actor, correlationId: actor.appUserId, locale: "ko" as const, query: null, celebrityId: null, accountStatus: null, cursor: null, limit: 50 };
const fan = { fanId, nickname: "Fan", accountStatus: "active", maskedWallet: null, createdAt: "2026-09-11", celebritySummaries: [], cursor: { createdAt: "2026-09-11", id: fanId } };
function setup() {
  const base = { list: vi.fn().mockResolvedValue({ items: [fan], nextCursor: null }), detail: vi.fn(), adjust: vi.fn() } as unknown as FanOperationsRepository;
  const query = vi.fn().mockResolvedValue({ data: [
    { id: fanId, verified_email: "fan@example.com", privy_user_id: "owner", full_name: "Secret Real Name" },
    { id: "unrequested", verified_email: "other@example.com", privy_user_id: "other" },
  ], error: null });
  const select = vi.fn(() => ({ in: query }));
  const from = vi.fn(() => ({ select }));
  const providers = vi.fn().mockResolvedValue(new Map([["owner", ["google"]]]));
  const repo = withFanAccountInfo(base, { from } as never, providers);
  return { base, query, select, from, providers, repo };
}
describe("authorized member account enrichment", () => {
  it("reads only approved IDs, returns email/provider only, and preserves pagination", async () => {
    const { repo, query, select, providers } = setup();
    const page = await repo.list(listInput);
    expect(query).toHaveBeenCalledWith("id", [fanId]);
    expect(select).toHaveBeenCalledWith("id,verified_email,privy_user_id");
    expect(providers).toHaveBeenCalledWith(["owner"]);
    expect(page).toEqual({ items: [{ ...fan, email: "fan@example.com", loginProviders: ["google"] }], nextCursor: null });
    expect(JSON.stringify(page)).not.toMatch(/privy_user_id|other@example|Secret Real|owner/);
  });
  it("does not read private identity data if the authorization RPC fails", async () => {
    const { repo, base, from, providers } = setup();
    vi.mocked(base.list).mockRejectedValue(new FanOperationsRepositoryError("FORBIDDEN"));
    await expect(repo.list(listInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(from).not.toHaveBeenCalled(); expect(providers).not.toHaveBeenCalled();
  });
  it("skips empty pages and tolerates a fan disappearing after the authorized read", async () => {
    const { repo, base, from, query, providers } = setup();
    vi.mocked(base.list).mockResolvedValueOnce({ items: [], nextCursor: null });
    await repo.list(listInput); expect(from).not.toHaveBeenCalled();
    query.mockResolvedValue({ data: [], error: null });
    expect((await repo.list(listInput)).items[0]).toMatchObject({ email: null, loginProviders: null });
    expect(providers).toHaveBeenCalledWith([]);
  });
  it("keeps the member email available when provider lookup is unavailable", async () => {
    const { repo, providers } = setup();
    providers.mockResolvedValue(new Map([["owner", null]]));
    expect((await repo.list(listInput)).items[0]).toMatchObject({ email: "fan@example.com", loginProviders: null });
  });
  it("returns a private 503 with no database details if identity lookup fails", async () => {
    const { repo, query, providers } = setup();
    query.mockResolvedValue({ data: null, error: { message: "private database information" } } as never);
    const run = createGetFansHandler({ repository: repo, authorize: vi.fn().mockResolvedValue({ ...actor, role: "admin", email: "admin@example.com" }) });
    const response = await run(new Request("https://byus.test/api/admin/fans"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(await response.text()).not.toContain("database information");
    expect(providers).not.toHaveBeenCalled();
  });
});
