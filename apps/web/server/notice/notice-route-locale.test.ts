import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET as listNotices } from "../../app/api/public/celebrities/[slug]/notices/route";
import { GET as readNotice } from "../../app/api/public/celebrities/[slug]/notices/[noticeSlug]/route";

describe("public notice locale boundary", () => {
  it.each([
    "locale=fr",
    "locale=ko&locale=en",
  ])("returns INVALID_LOCALE before repository setup for %s", async (query) => {
    const list = await listNotices(new Request(`https://byus.test/api?${query}`), {
      params: Promise.resolve({ slug: "kara" }),
    });
    expect(list.status).toBe(400);
    await expect(list.json()).resolves.toEqual({ error: { code: "INVALID_LOCALE" } });

    const detail = await readNotice(new Request(`https://byus.test/api?${query}`), {
      params: Promise.resolve({ slug: "kara", noticeSlug: "welcome" }),
    });
    expect(detail.status).toBe(400);
    await expect(detail.json()).resolves.toEqual({ error: { code: "INVALID_LOCALE" } });
  });
});
