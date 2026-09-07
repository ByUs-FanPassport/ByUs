import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readInstagramMedia } from "./repository";

const now = Date.parse("2026-09-08T00:00:00Z");
function database(celebrity: unknown, connection: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValueOnce({ data: celebrity, error: null }).mockResolvedValueOnce({ data: connection, error: null }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const db = { from: vi.fn(() => chain) };
  return { db: db as unknown as SupabaseClient, chain, from: db.from };
}
describe("public Instagram projection", () => {
  it("does not read a connection for an unpublished or missing celebrity", async () => {
    const { db, chain, from } = database(null, null);
    expect(await readInstagramMedia(db, "hidden", now)).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("status", "published");
    expect(from).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { media: [], media_fetched_at: new Date(now - 80 * 60000).toISOString(), token_expires_at: new Date(now + 86400000).toISOString(), last_error: null },
    { media: [], media_fetched_at: new Date(now).toISOString(), token_expires_at: new Date(now - 1).toISOString(), last_error: null },
    { media: [], media_fetched_at: new Date(now).toISOString(), token_expires_at: new Date(now + 86400000).toISOString(), last_error: "MEDIA_UNAVAILABLE" },
  ])("hides missing, stale, expired or failed connections", async (connection) => {
    const { db, chain } = database({ id: "creator" }, connection);
    expect(await readInstagramMedia(db, "creator", now)).toEqual({ items: [], updatedAt: null });
    expect(JSON.stringify(chain.select.mock.calls)).not.toContain("token_ciphertext");
  });
});
