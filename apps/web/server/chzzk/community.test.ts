import { describe, expect, it, vi } from "vitest";
import { CHZZK_CHANNEL_ID } from "@/features/fanpage/domain/chzzk-posts";
import { CHZZK_POSTS_URL, createChzzkReader, parseChzzkPosts, readChzzkPost, createChzzkPageReader, parseChzzkPage } from "./community";

function entry(overrides: Record<string, unknown> = {}) {
  return { comment: { commentId: 123, objectType: "CHANNEL_POST", objectId: CHZZK_CHANNEL_ID,
    secret: false, deleted: false, hideByCleanBot: false, content: "방송 일정\n오늘 만나요", createdDate: "20260910005417",
    attaches: [{ attachType: "PHOTO", attachValue: "https://nng-phinf.pstatic.net/schedule.jpg", order: 1 }], ...overrides },
  user: { userIdHash: CHZZK_CHANNEL_ID, userNickname: "정제니젠젠" } };
}
const body = (entries: unknown[]) => ({ code: 200, content: { comments: { data: entries } } });

describe("CHZZK public posts", () => {
  it("projects only public creator post fields with safe image URLs", () => {
    expect(parseChzzkPosts(body([entry()]))).toEqual([{ id: "123", text: "방송 일정\n오늘 만나요", date: "2026-09-10", images: [{ url: "https://nng-phinf.pstatic.net/schedule.jpg" }] }]);
  });
  it("excludes private, deleted, moderated, foreign-channel and non-creator entries", () => {
    const entries = [entry({ secret: true }), entry({ deleted: true }), entry({ hideByCleanBot: true }),
      entry({ objectId: "another" }), entry({ objectType: "CHANNEL_COMMENT" }), entry({ secret: undefined }),
      { ...entry(), user: { userIdHash: "someone-else" } }, entry({ createdDate: "20260230000000" })];
    expect(parseChzzkPosts(body(entries))).toEqual([]);
  });
  it("rejects hostile image origins, retains text, and deduplicates", () => {
    const attaches = ["javascript:alert(1)", "https://nng-phinf.pstatic.net.evil.test/a", "https://user@nng-phinf.pstatic.net/a", "https://evil.test/a"]
      .map((attachValue) => ({ attachType: "PHOTO", attachValue, order: 1 }));
    const result = parseChzzkPosts(body([entry({ attaches }), entry({ attaches })]));
    expect(result).toHaveLength(1);
    expect(result[0]?.images).toEqual([]);
    expect(() => parseChzzkPosts({ code: 403 })).toThrow();
  });
  it("coalesces reads and replaces cached posts after 15 minutes without serving expired data on failure", async () => {
    let time = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(body([entry()]))))
      .mockResolvedValueOnce(new Response(JSON.stringify(body([]))))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const read = createChzzkReader(fetcher, () => time);
    const [first, parallel] = await Promise.all([read(), read()]);
    expect(first).toEqual(parallel);
    expect(first).toHaveLength(1);
    expect(await read()).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(CHZZK_POSTS_URL, expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
    time = 900_001;
    expect(await read()).toEqual([]);
    time += 900_001;
    await expect(read()).rejects.toThrow("CHZZK unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("CHZZK detail", () => {
  it("reads an exact public post and rejects private or mismatched entries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({code:200,content:entry()})));
    expect((await readChzzkPost("123",fetcher))?.id).toBe("123");
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/comments\/123$/),expect.objectContaining({credentials:"omit",cache:"no-store"}));
    expect(await readChzzkPost("124",fetcher)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({code:200,content:entry({secret:true})})));
    expect(await readChzzkPost("123",fetcher)).toBeNull();
    fetcher.mockClear();
    expect(await readChzzkPost("../123",fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes absent posts from upstream failures",async()=>{
    expect(await readChzzkPost("123",vi.fn().mockResolvedValue(new Response(null,{status:404})))).toBeNull();
    await expect(readChzzkPost("123",vi.fn().mockResolvedValue(new Response(null,{status:503})))).rejects.toThrow();
  });
});

describe("CHZZK pagination",()=>{
  it("advances by upstream rows including filtered private posts and ends on missing comments",()=>{
    const rows=Array.from({length:10},(_,i)=>entry({commentId:i+1,secret:i===0}));
    const page=parseChzzkPage({code:200,content:{comments:{data:rows,totalCount:11}}},0);
    expect(page.items).toHaveLength(9);expect(page.nextCursor).toBe("10");
    expect(parseChzzkPage({code:200,content:{comments:{data:[entry()],totalCount:11}}},10).nextCursor).toBeNull();
    expect(parseChzzkPage({code:200,content:{commentActive:true}},20)).toEqual({items:[],nextCursor:null});
  });
  it("fetches the requested offset and isolates channel and cursor caches",async()=>{
    const other="a".repeat(32);
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({code:200,content:{comments:{data:[entry()],totalCount:21}}})));
    const read=createChzzkPageReader(fetcher);
    await read(CHZZK_CHANNEL_ID);await read(CHZZK_CHANNEL_ID,"10");
    expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("offset=10"),expect.anything());
    expect((await read(other)).items).toEqual([]);
    await read(CHZZK_CHANNEL_ID,"10");expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(read(CHZZK_CHANNEL_ID,"-1")).rejects.toThrow();
  });
});
