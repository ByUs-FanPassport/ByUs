import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/fanpage/dependencies", () => ({ createFanpageDependencies: vi.fn(() => { throw new Error("Paused routes must not construct clients"); }) }));
vi.mock("@/server/seo/public-content", () => ({ loadSeoCreator: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
import { GET, POST } from "@/app/api/celebrities/[slug]/lounge/route";
import { PUT } from "@/app/api/lounge-messages/[id]/reactions/route";
import { GET as visibilityGet, PATCH as visibilityPatch } from "@/app/api/me/fan-activity-visibility/route";
import Page from "@/app/c/[slug]/lounge/page";
import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { loadSeoCreator } from "@/server/seo/public-content";
import { redirect } from "next/navigation";

beforeEach(() => vi.clearAllMocks());
describe("paused public lounge", () => {
  it.each([GET, POST, PUT])("closes conversation reads and writes before client construction", async (handler) => {
    const response = await handler();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "LOUNGE_NOT_AVAILABLE" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createFanpageDependencies).not.toHaveBeenCalled();
  });
  it.each(["ko", "en"] as const)("returns an existing lounge link to the %s fan page", async (locale) => {
    vi.mocked(loadSeoCreator).mockResolvedValue({ slug: "elina" } as Awaited<ReturnType<typeof loadSeoCreator>>);
    await expect(Page({ params: Promise.resolve({ slug: "elina" }), searchParams: Promise.resolve({ locale }) })).rejects.toThrow(`REDIRECT:/c/elina?locale=${locale}#cheers`);
    expect(loadSeoCreator).toHaveBeenCalledWith("elina", locale);
  });
  it("does not expose a missing or unpublished creator through the redirect", async () => {
    vi.mocked(loadSeoCreator).mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ slug: "private-creator" }), searchParams: Promise.resolve({ locale: "ko" }) })).rejects.toThrow("NOT_FOUND");
    expect(redirect).not.toHaveBeenCalled();
  });
});

it.each([visibilityGet, visibilityPatch])("retires visibility without auth or environment dependencies", async handler => {
  const response = await handler();
  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({ error: { code: "FAN_ACTIVITY_VISIBILITY_RETIRED" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(createFanpageDependencies).not.toHaveBeenCalled();
});
