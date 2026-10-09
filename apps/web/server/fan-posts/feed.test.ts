import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createFeedHandler, type FeedDependencies } from "./feed";

const noticeId = "00000000-0000-4000-8000-000000000001";
const postId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const checkpoint = { offset: 1, anchor: "a".repeat(64), fingerprint: "b".repeat(64), count: 1 };
const completeWindow = { frontier: null, truncated: false } as const;
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Official" }] }] };
const notice = {
  kind: "notice" as const, id: noticeId, slug: "welcome", title: "Welcome", body,
  pinned: true, noticeKind: "welcome" as const, postType: "notice" as const, visibility: "public" as const,
  revision: 1, publishedAt: "2026-09-01T00:00:00Z", commentCount: 2,
};
const post = {
  kind: "fan_post" as const, id: postId, celebritySlug: "artist", body: "Fan post", visibility: "public" as const,
  revision: 1, author: { nickname: "Fan", avatarUrl: "/images/avatars/star-pink.webp" }, assets: [],
  createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", isOwner: false,
  likeCount: 0, liked: false, commentCount: 0,
};
const chzzk = { id: "99", text: "Official channel", date: "2026-10-01", images: [] };

function dependencies(): FeedDependencies {
  return {
    rpc: vi.fn(), authorize: vi.fn().mockResolvedValue({ appUserId: userId }), authorizeAdmin: vi.fn(),
    chzzkChannel: vi.fn().mockResolvedValue("a".repeat(32)), readChzzk: vi.fn(),
  };
}
const request = (query = "", authorization?: string) => new Request(`https://byus.test/api/celebrities/artist/feed${query}`, {
  headers: authorization ? { authorization } : undefined,
});

describe("unified creator feed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges pinned official, CHZZK, and fan rows without dropping an unread database row", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc)
      .mockResolvedValueOnce({ entries: [{ pinRank: 1, item: notice }, { pinRank: 0, item: post }], hasMore: false })
      .mockResolvedValueOnce({ entries: [{ pinRank: 0, item: post }], hasMore: false });
    vi.mocked(deps.readChzzk).mockResolvedValue({
      items: [{ item: chzzk, after: checkpoint, hasMore: false }], start: { ...checkpoint, offset: 0 }, hasMore: true, ...completeWindow,
    });
    const handler = createFeedHandler(deps);
    const first = await handler(request("?limit=2"), "artist");
    const firstBody = await first.json();
    expect(firstBody.items.map((item: { kind: string }) => item.kind)).toEqual(["notice", "chzzk"]);
    expect(firstBody.items[0].body).toEqual(body);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("vary")).toBe("Authorization");
    expect((await handler(request(`?limit=2&cursor=${firstBody.nextCursor}`), "other-artist")).status).toBe(400);

    const second = await handler(request(`?limit=2&cursor=${firstBody.nextCursor}`), "artist");
    expect((await second.json()).items).toEqual([post]);
    expect(deps.rpc).toHaveBeenLastCalledWith("read_unified_creator_feed", expect.objectContaining({
      p_before_kind: "notice", p_before_id: noticeId,
    }));
    expect(deps.readChzzk).toHaveBeenCalledTimes(1);
  });

  it("returns database content and marks CHZZK unavailable without exposing provider errors", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc).mockResolvedValue({ entries: [{ pinRank: 0, item: post }], hasMore: false });
    vi.mocked(deps.readChzzk).mockRejectedValue(new Error("provider secret"));
    const result = await createFeedHandler(deps)(request(), "artist");
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ items: [post], nextCursor: null, unavailableSources: ["chzzk"] });
  });

  it("requires a page-one refresh when the external unread boundary changes", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc).mockResolvedValue({ entries: [], hasMore: false });
    vi.mocked(deps.readChzzk)
      .mockResolvedValueOnce({ items: [{ item: chzzk, after: checkpoint, hasMore: true }], start: checkpoint, hasMore: true, ...completeWindow })
      .mockRejectedValueOnce(new Error("FEED_CURSOR_EXPIRED"));
    const handler = createFeedHandler(deps);
    const first = await handler(request("?source=official&news=chzzk&limit=1"), "artist");
    const cursor = (await first.json()).nextCursor;
    const expired = await handler(request(`?source=official&news=chzzk&limit=1&cursor=${cursor}`), "artist");
    expect(expired.status).toBe(409);
    expect(await expired.json()).toEqual({ error: { code: "FEED_CURSOR_EXPIRED" } });
  });

  it("preserves provider order for date-only CHZZK rows across pages", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc).mockResolvedValue({ entries: [], hasMore: false });
    const firstAfter = { ...checkpoint, offset: 1 };
    const secondAfter = { ...checkpoint, offset: 2 };
    vi.mocked(deps.readChzzk)
      .mockResolvedValueOnce({ items: [
        { item: { ...chzzk, id: "10" }, after: firstAfter, hasMore: true },
        { item: { ...chzzk, id: "9" }, after: secondAfter, hasMore: false },
      ], start: { ...checkpoint, offset: 0 }, hasMore: true, ...completeWindow })
      .mockResolvedValueOnce({ items: [
        { item: { ...chzzk, id: "9" }, after: secondAfter, hasMore: false },
      ], start: firstAfter, hasMore: true, ...completeWindow });
    const handler = createFeedHandler(deps);
    const first = await handler(request("?source=official&news=chzzk&limit=1"), "artist");
    const firstBody = await first.json();
    expect(firstBody.items[0].id).toBe("10");
    const second = await handler(request(`?source=official&news=chzzk&limit=1&cursor=${firstBody.nextCursor}`), "artist");
    expect((await second.json()).items[0].id).toBe("9");
  });

  it("holds unpinned database rows while a filtered external scan has no known item frontier", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc).mockResolvedValue({ entries: [{ pinRank: 0, item: post }], hasMore: false });
    vi.mocked(deps.readChzzk).mockResolvedValue({
      items: [], start: { ...checkpoint, offset: 60 }, hasMore: true,
      frontier: "2026-09-25T00:00:00.000Z", truncated: true,
    });
    const result = await createFeedHandler(deps)(request("?limit=20"), "artist");
    const data = await result.json();
    expect(data.items).toEqual([]);
    expect(data.nextCursor).toEqual(expect.any(String));
  });

  it("returns a short page and holds database rows behind a partial external scan frontier", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc).mockResolvedValue({ entries: [{ pinRank: 0, item: { ...post, createdAt: "2026-09-01T00:00:00Z" } }], hasMore: false });
    vi.mocked(deps.readChzzk).mockResolvedValue({
      items: [{ item: chzzk, after: checkpoint, hasMore: true }], start: { ...checkpoint, offset: 0 }, hasMore: true,
      frontier: "2026-09-15T00:00:00.000Z", truncated: true,
    });
    const result = await createFeedHandler(deps)(request("?limit=20"), "artist");
    const data = await result.json();
    expect(data.items).toEqual([{ ...chzzk, kind: "chzzk" }]);
    expect(data.nextCursor).toEqual(expect.any(String));
  });

  it("validates cursor query binding and optional authentication", async () => {
    const deps = dependencies();
    vi.mocked(deps.rpc).mockResolvedValue({ entries: [], hasMore: false });
    vi.mocked(deps.chzzkChannel).mockResolvedValue(null);
    const handler = createFeedHandler(deps);
    expect((await handler(request("?source=fans"), "artist")).status).toBe(200);
    expect(deps.authorize).not.toHaveBeenCalled();
    const first = await handler(request("?source=fans&limit=1", "Bearer token"), "artist");
    expect(deps.authorize).toHaveBeenCalledWith("Bearer token");
    const cursor = (await first.json()).nextCursor;
    expect(cursor).toBeNull();
    expect((await handler(request("?source=unknown"), "artist")).status).toBe(400);
  });
});
