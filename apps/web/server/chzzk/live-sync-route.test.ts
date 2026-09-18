import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGetChzzkLiveSyncHandler } from "./live-sync-route";

const secret = "cron-secret-with-at-least-32-characters";
const request = (authorization?: string) => new Request("https://byus.test/api/internal/chzzk/live-sync", {
  headers: authorization ? { authorization } : undefined,
});

describe("CHZZK LIVE sync cron route", () => {
  it("authenticates before it reports a disabled collection", async () => {
    const run = vi.fn();
    const handler = createGetChzzkLiveSyncHandler({ secret, enabled: false, run });
    expect((await handler(request())).status).toBe(401);
    const response = await handler(request(`Bearer ${secret}`));
    await expect(response.json()).resolves.toEqual({ skipped: "collection_disabled" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns a redacted failure and does not disclose credential material", async () => {
    const run = vi.fn(async () => { throw new Error(`provider failure ${secret}`); });
    const response = await createGetChzzkLiveSyncHandler({ secret, enabled: true, run })(request(`Bearer ${secret}`));
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ error: { code: "CHZZK_LIVE_SYNC_UNAVAILABLE" } });
    expect(body).not.toContain(secret);
  });
});
