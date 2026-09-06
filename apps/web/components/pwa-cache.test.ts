import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const code = readFileSync("public/sw.js", "utf8");
type Cache = Map<string, Response>;
type Event = { request?: Request; waitUntil: (promise: Promise<unknown>) => void; respondWith: (promise: Promise<Response>) => void };

function harness() {
  const stores = new Map<string, Cache>([["byus-shell-v1", new Map([["/", new Response("old home")]])], ["another-app", new Map()]]);
  const listeners: Record<string, (event: Event) => void> = {};
  const tasks: Promise<unknown>[] = [];
  const fetcher = vi.fn(async () => new Response("live response"));
  const key = (request: Request | string) => typeof request === "string" ? request : new URL(request.url).pathname;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return {
        addAll: async (paths: string[]) => { for (const path of paths) stores.get(name)!.set(path, new Response(path)); },
        put: async (request: Request, response: Response) => { stores.get(name)!.set(key(request), response); },
      };
    },
    match: async (request: Request | string) => {
      for (const store of stores.values()) { const value = store.get(key(request)); if (value) return value.clone(); }
      return undefined;
    },
  };
  vm.runInNewContext(code, {
    self: { addEventListener: (name: string, callback: (event: Event) => void) => { listeners[name] = callback; }, location: { origin: "https://byus.kr" }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } },
    caches, fetch: fetcher, URL, Response,
  });
  const event = (): Event => ({ waitUntil: (promise) => { tasks.push(promise); }, respondWith: () => {} });
  return {
    stores, fetcher, listeners,
    async install() { listeners.install(event()); await Promise.all(tasks); listeners.activate(event()); await Promise.all(tasks); },
    async request(path: string, mode = "cors", headers: Record<string, string> = {}) {
      let response: Promise<Response> | undefined;
      const request = { url: `https://byus.kr${path}`, method: "GET", mode, headers: new Headers(headers) } as Request;
      listeners.fetch({ ...event(), request, respondWith: (value) => { response = value; } });
      const resolved = await response;
      await Promise.all(tasks);
      return resolved;
    },
  };
}

describe("PWA static cache boundary", () => {
  it("updates old shell caches without touching other applications or keeping HTML", async () => {
    const h = harness(); await h.install();
    expect([...h.stores.keys()]).toEqual(["another-app", "byus-shell-v2"]);
    expect(h.stores.get("byus-shell-v2")!.has("/")).toBe(false);
    expect(h.stores.get("byus-shell-v2")!.has("/offline.html")).toBe(true);
    expect(h.listeners.push).toBeTypeOf("function");
    expect(h.listeners.notificationclick).toBeTypeOf("function");
  });

  it("never intercepts RSC, owner APIs or authenticated image requests", async () => {
    const h = harness(); await h.install();
    for (const path of ["/?_rsc=abc", "/api/me/summary", "/api/me/avatar", "/settings?_rsc=abc"]) {
      expect(await h.request(path)).toBeUndefined();
    }
    expect(await h.request("/", "cors", { RSC: "1" })).toBeUndefined();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("uses an independent offline document only for failed navigation, then returns live HTML on reconnect or rollback", async () => {
    const h = harness(); await h.install();
    h.fetcher.mockRejectedValueOnce(new Error("offline"));
    expect(await (await h.request("/my?locale=en", "navigate"))!.text()).toBe("/offline.html");
    h.fetcher.mockResolvedValueOnce(new Response("previous frontend after rollback"));
    expect(await (await h.request("/", "navigate"))!.text()).toBe("previous frontend after rollback");
    expect(h.stores.get("byus-shell-v2")!.has("/")).toBe(false);
    h.fetcher.mockResolvedValueOnce(new Response("server error", { status: 503 }));
    expect((await h.request("/", "navigate"))!.status).toBe(503);
  });
});
