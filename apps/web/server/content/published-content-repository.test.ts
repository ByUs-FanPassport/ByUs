import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabasePublishedContentRepository } from "./published-content-repository";

const row = {
  slug: "kara",
  locale: "ko",
  name: "KARA",
  summary: "공개 소개",
  image_url: "/kara.jpg",
  image_alt: "KARA",
  image_position: "center",
  themes: [],
  social_links: [],
};

function queryResult(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockResolvedValue({ data, error });
  return query;
}

describe("SupabasePublishedContentRepository", () => {
  it("reads only the safe published view and maps its rows", async () => {
    const query = queryResult([row]);
    const client = { from: vi.fn(() => query) };
    const repository = new SupabasePublishedContentRepository(client);

    await expect(repository.list("ko")).resolves.toEqual([
      expect.objectContaining({ slug: "kara", locale: "ko" }),
    ]);
    expect(client.from).toHaveBeenCalledWith("published_celebrities");
    expect(query.select).toHaveBeenCalledWith(
      "slug,locale,name,summary,image_url,image_alt,image_position,themes,social_links",
    );
    expect(query.eq).toHaveBeenCalledWith("locale", "ko");
    expect(query.order).toHaveBeenCalledWith("slug", { ascending: true });
  });

  it("does not return malformed projection data", async () => {
    const query = queryResult([{ ...row, name: "" }]);
    const repository = new SupabasePublishedContentRepository({ from: () => query });
    await expect(repository.list("ko")).rejects.toThrow("Published content projection");
  });

  it("fails closed when Supabase reports an error", async () => {
    const query = queryResult(null, { message: "permission denied" });
    const repository = new SupabasePublishedContentRepository({ from: () => query });
    await expect(repository.list("en")).rejects.toThrow("Published content query failed");
  });
});
