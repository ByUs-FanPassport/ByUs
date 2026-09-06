import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createGetCreatorReactionsHandler, type CreatorReactionBatchRouteDependencies } from "./creator-reaction-batch-route";

const request = (query: string, authorization = "Bearer token") => new Request(`https://byus.test/api/me/creator-reactions?${query}`, { headers: { authorization } });
const dependencies = (): CreatorReactionBatchRouteDependencies => ({
  authorize: vi.fn(async () => ({ appUserId: "owner-1" })),
  repository: { findMany: vi.fn(async ({ celebritySlugs }: { celebritySlugs: readonly string[] }) => celebritySlugs.map((slug) => ({ slug, reacted: slug === "kara" }))) },
});

describe("owned creator reaction batch route", () => {
  it("deduplicates a valid raw slug list and returns private owner state", async () => {
    const deps = dependencies();
    const response = await createGetCreatorReactionsHandler(deps)(request("slugs=kara%2Celina%2Ckara"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(deps.repository.findMany).toHaveBeenCalledWith({ appUserId: "owner-1", celebritySlugs: ["kara", "elina"] });
    await expect(response.json()).resolves.toEqual({ states: { kara: { reacted: true }, elina: { reacted: false } } });
  });

  it("rejects empty, malformed, repeated query keys, and more than 50 raw slugs", async () => {
    const invalid = ["", "slugs=", "slugs=KARA", "slugs=kara%2Fadmin", "slugs=kara&slugs=elina", `slugs=${Array.from({ length: 51 }, (_, index) => `c${index}`).join("%2C")}`];
    for (const query of invalid) expect((await createGetCreatorReactionsHandler(dependencies())(request(query))).status).toBe(400);
  });

  it("does not expose a false state when auth or the batch read is unavailable", async () => {
    const denied = dependencies();
    denied.authorize = vi.fn(async () => { throw new AuthError("AUTHENTICATION_REQUIRED", 403, "denied"); });
    expect((await createGetCreatorReactionsHandler(denied)(request("slugs=kara"))).status).toBe(403);
    const missing = dependencies();
    missing.repository.findMany = vi.fn(async () => { throw new Error("missing state"); });
    const response = await createGetCreatorReactionsHandler(missing)(request("slugs=kara"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "REACTION_UNAVAILABLE" } });
  });
});
