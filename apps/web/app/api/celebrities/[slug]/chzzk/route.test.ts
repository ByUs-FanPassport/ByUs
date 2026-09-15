import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createChzzkHandler } from "./route";
import { CHZZK_CHANNEL_URL, CHZZK_CREATOR_SLUG } from "@/features/fanpage/domain/chzzk-posts";

const request = new Request("https://byus.kr/api/celebrities/jenny-jeong/chzzk");
const context = (slug = CHZZK_CREATOR_SLUG) => ({ params: Promise.resolve({ slug }) });
const creator = { socialLinks: [{ platform: "chzzk", url: CHZZK_CHANNEL_URL }] };

describe("creator CHZZK route", () => {
  it("requires a published creator with a valid channel before reading posts", async () => {
    const findBySlug = vi.fn().mockResolvedValue(creator);
    const read = vi.fn().mockResolvedValue({items:[],nextCursor:null});
    const handler = createChzzkHandler({ findBySlug }, read);

    findBySlug.mockResolvedValueOnce(null).mockResolvedValueOnce({ socialLinks: [] });
    expect((await handler(request, context())).status).toBe(404);
    expect((await handler(request, context())).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
    const response = await handler(request, context());
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith("0a3f97086cb81d3360c69fdf5d020045",null);
    expect((await handler(new Request(request.url+"?cursor=10"),context("another-creator"))).status).toBe(200);
    expect(read).toHaveBeenLastCalledWith("0a3f97086cb81d3360c69fdf5d020045","10");
    expect((await handler(new Request(request.url+"?cursor=-1"),context())).status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
  });
  it("distinguishes unavailable from an empty feed without exposing upstream details", async () => {
    const handler = createChzzkHandler({ findBySlug: vi.fn().mockResolvedValue(creator) }, vi.fn().mockRejectedValue(new Error("internal details")));
    const response = await handler(request, context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "chzzk_unavailable" });
  });
});
