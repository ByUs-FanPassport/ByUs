import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseCalendarCreatorImageLookup } from "./calendar-creator-images";

function queryResult(data: unknown, error: { message: string } | null = null) {
  const query = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), is: vi.fn() };
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockResolvedValue({ data, error });
  return query;
}

describe("SupabaseCalendarCreatorImageLookup", () => {
  it("maps only published calendar LIVE slugs to their public creator identity", async () => {
    const query = queryResult([{ slug: "creator-live", celebrities: { slug: "creator", image_position: "50% 35%" } }]);
    const client = { from: vi.fn(() => query) };

    await expect(new SupabaseCalendarCreatorImageLookup(client).readByLiveSlugs(["creator-live", "creator-live"])).resolves.toEqual({
      "creator-live": { celebritySlug: "creator", imagePosition: "50% 35%" },
    });
    expect(client.from).toHaveBeenCalledWith("live_events");
    expect(query.select).toHaveBeenCalledWith("slug,celebrities!inner(slug,image_position)");
    expect(query.in).toHaveBeenCalledWith("slug", ["creator-live"]);
    expect(query.eq).toHaveBeenNthCalledWith(1, "publication_status", "published");
    expect(query.eq).toHaveBeenNthCalledWith(2, "celebrities.status", "published");
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
  });

  it("does not query for an empty calendar", async () => {
    const query = queryResult([]);
    const client = { from: vi.fn(() => query) };

    await expect(new SupabaseCalendarCreatorImageLookup(client).readByLiveSlugs([])).resolves.toEqual({});
    expect(client.from).not.toHaveBeenCalled();
  });
});
