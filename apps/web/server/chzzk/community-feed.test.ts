import { describe, expect, it, vi } from "vitest";
import { createChzzkWindowReader } from "./community";

const channelId = "a".repeat(32);
function row(id: number, overrides: Record<string, unknown> = {}) {
  return { comment: { commentId: id, objectType: "CHANNEL_POST", objectId: channelId, secret: false, deleted: false,
    hideByCleanBot: false, content: `post ${id}`, createdDate: "20261001000000", attaches: null, ...overrides }, user: { userIdHash: channelId } };
}
const payload = (rows: unknown[], totalCount: number) => ({ code: 200, content: { comments: { data: rows, totalCount } } });

describe("CHZZK unified-feed window", () => {
  it("bypasses cache and expires a cursor when the unread raw boundary changes", async () => {
    let shifted = false;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      const rows = Array.from({ length: Math.min(10, 12 - offset) }, (_, index) => row(offset + index + (shifted ? 100 : 1)));
      return new Response(JSON.stringify(payload(rows, 12)), { status: 200 });
    }) as unknown as typeof fetch;
    const read = createChzzkWindowReader(fetcher, () => 1);
    const first = await read(channelId, null, 1);
    expect(first.items[0]?.item.id).toBe("1");
    expect(first.truncated).toBe(false);
    shifted = true;
    await expect(read(channelId, first.items[0]!.after, 1)).rejects.toThrow("FEED_CURSOR_EXPIRED");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("bounds scans when every provider row is filtered and keeps those rows out of the result", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return new Response(JSON.stringify(payload(Array.from({ length: 10 }, (_, index) => row(offset + index + 1, { secret: true })), 100)), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await createChzzkWindowReader(fetcher, () => 1)(channelId, null, 1);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.frontier).toBe("2026-10-01T00:00:00.000Z");
    expect(result.start.offset).toBe(60);
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it("resumes after a truncated scan when filtered rows separate public posts", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      const rows = Array.from({ length: Math.min(10, 100 - offset) }, (_, index) => {
        const rawOffset = offset + index;
        return row(rawOffset + 1, { secret: rawOffset !== 0 && rawOffset !== 60 });
      });
      return new Response(JSON.stringify(payload(rows, 100)), { status: 200 });
    }) as unknown as typeof fetch;
    const read = createChzzkWindowReader(fetcher, () => 1);

    const first = await read(channelId, null, 2);
    expect(first.items.map(entry => entry.item.id)).toEqual(["1"]);
    expect(first.items[0]?.after).toMatchObject({ offset: 60, anchor: expect.stringMatching(/^[a-f0-9]{64}$/), count: 10 });
    expect(first.truncated).toBe(true);

    const second = await read(channelId, first.items[0]!.after, 2);
    expect(second.items.map(entry => entry.item.id)).toEqual(["61"]);
    expect(second.items[0]?.hasMore).toBe(false);
    expect(second.truncated).toBe(false);
  });
});
