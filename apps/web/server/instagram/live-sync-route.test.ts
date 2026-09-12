import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGetInstagramLiveSyncHandler } from "./live-sync-route";

const secret = "cron-secret-with-at-least-32-characters";
const request = (authorization?: string) => new Request("https://byus.test/api/internal/instagram/live-sync", {
  headers: authorization ? { authorization } : undefined,
});

describe("Instagram LIVE sync cron route", () => {
  it.each([undefined, "Bearer wrong-secret", `Bearer ${"x".repeat(31)}`])("returns 401 for missing or wrong auth %s", async (authorization) => {
    const run = vi.fn();
    const response = await createGetInstagramLiveSyncHandler({ secret, enabled: true, run })(request(authorization));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(run).not.toHaveBeenCalled();
  });

  it("authenticates before skipping disabled collection and never runs it", async () => {
    const run = vi.fn();
    const handler = createGetInstagramLiveSyncHandler({ secret, enabled: false, run });
    const unauthorized = await handler(request());
    expect(unauthorized.status).toBe(401);
    const response = await handler(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ skipped: "collection_disabled" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns authorized sync results", async () => {
    const results = [{ celebrityId: "11111111-1111-4111-8111-111111111111", status: "live" }];
    const run = vi.fn(async () => results);
    const response = await createGetInstagramLiveSyncHandler({ secret, enabled: true, run })(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results });
    expect(run).toHaveBeenCalledOnce();
  });

  it("maps sync failures to a redacted 503 response", async () => {
    const privateMessage = `provider failed with ${secret}`;
    const run = vi.fn(async () => { throw new Error(privateMessage); });
    const response = await createGetInstagramLiveSyncHandler({ secret, enabled: true, run })(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "INSTAGRAM_LIVE_SYNC_UNAVAILABLE" } });
    expect(text).not.toContain(secret);
    expect(text).not.toContain(privateMessage);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
