import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PublicImagePublishedContentRepository,
  SupabasePublishedContentRepository,
} from "./published-content-repository";

const row = {
  slug: "kara",
  locale: "ko",
  name: "KARA",
  summary: "공개 소개",
  image_url: "/kara.jpg",
  image_alt: "KARA",
  image_position: "center",
  primary_role: "idol" as const, themes: [],
  social_links: [],
  display_order: 3,
  fan_count: 12_800_000,
};

function queryResult(data: unknown, error: { message?: string } | null = null) {
  const result = Promise.resolve({ data, error });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn(),
    then: result.then.bind(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data, error });
  query.maybeSingle.mockResolvedValue({ data, error });
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
      "slug,locale,name,summary,image_url,image_alt,image_position,themes,social_links,display_order,fan_count,primary_role",
    );
    expect(query.eq).toHaveBeenCalledWith("locale", "ko");
    expect(query.order).toHaveBeenNthCalledWith(1, "display_order", { ascending: true });
    expect(query.order).toHaveBeenNthCalledWith(2, "slug", { ascending: true });
    expect(query.range).toHaveBeenCalledWith(0, 499);
  });

  it("finds one published projection by canonical locale and slug", async () => {
    const query = queryResult(row);
    const client = { from: vi.fn(() => query) };
    const repository = new SupabasePublishedContentRepository(client);

    await expect(repository.findBySlug("ko", "kara")).resolves.toEqual(
      expect.objectContaining({ slug: "kara", displayOrder: 3 }),
    );
    expect(query.eq).toHaveBeenNthCalledWith(1, "locale", "ko");
    expect(query.eq).toHaveBeenNthCalledWith(2, "slug", "kara");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it("uses the canonical slug as a deterministic tie breaker for equal administrator positions", async () => {
    const query = queryResult([
      { ...row, slug: "zeta", name: "Zeta", display_order: 3 },
      { ...row, slug: "alpha", name: "Alpha", display_order: 3 },
      { ...row, slug: "first", name: "First", display_order: 1 },
    ]);
    const repository = new SupabasePublishedContentRepository({ from: () => query });

    await expect(repository.list("ko")).resolves.toEqual([
      expect.objectContaining({ slug: "first" }),
      expect.objectContaining({ slug: "alpha" }),
      expect.objectContaining({ slug: "zeta" }),
    ]);
  });

  it("accumulates every stable page beyond the Supabase 1000-row response cap", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      ...row,
      slug: `creator-${String(index).padStart(4, "0")}`,
      name: `Creator ${index}`,
      display_order: Math.floor(index / 2),
    }));
    const ranges: Array<[number, number]> = [];
    const client = {
      from: vi.fn(() => {
        const query = queryResult([]);
        query.range.mockImplementation(async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null };
        });
        return query;
      }),
    };
    const repository = new SupabasePublishedContentRepository(client);

    const result = await repository.list("ko");

    expect(result).toHaveLength(1_001);
    expect(result.at(-1)).toEqual(expect.objectContaining({ slug: "creator-1000" }));
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it("fails the whole list when a later page fails", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      ...row,
      slug: `creator-${String(index).padStart(4, "0")}`,
      display_order: index,
    }));
    let page = 0;
    const client = {
      from: vi.fn(() => {
        const query = queryResult([]);
        query.range.mockImplementation(async () => page++ === 0
          ? { data: firstPage, error: null }
          : { data: null, error: { message: "page unavailable" } });
        return query;
      }),
    };

    await expect(new SupabasePublishedContentRepository(client).list("ko"))
      .rejects.toThrow("Published content query failed");
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("attaches approved photo roles after parsing with one batch per owner kind", async () => {
    const content = new SupabasePublishedContentRepository({
      from: () => queryResult([row, { ...row, slug: "elina", name: "Elina" }]),
    });
    const readCelebrityPhotoSetsBySlug = vi.fn().mockResolvedValue({
      kara: { profile: null },
    });
    const readLivePhotoSetsBySlug = vi.fn().mockResolvedValue({});
    const repository = new PublicImagePublishedContentRepository(content, {
      readCelebrityPhotoSetsBySlug,
      readLivePhotoSetsBySlug,
    });

    const result = await repository.list("ko");

    expect(readCelebrityPhotoSetsBySlug).toHaveBeenCalledExactlyOnceWith([
      "elina",
      "kara",
    ]);
    expect(result.find(({ slug }) => slug === "kara")?.image.photos).toEqual({ profile: null });
    expect(result.find(({ slug }) => slug === "elina")?.image).not.toHaveProperty("photos");
  });

  it("returns null for an unknown or unpublished slug projection", async () => {
    const query = queryResult(null);
    const repository = new SupabasePublishedContentRepository({ from: () => query });
    await expect(repository.findBySlug("en", "hidden")).resolves.toBeNull();
  });

  it("selects one live-first current or upcoming summary per celebrity", async () => {
    const query = queryResult([
      {
        slug: "kara-upcoming",
        celebrity_slug: "kara",
        locale: "ko",
        title: "Upcoming",
        starts_at: "2026-07-24T11:00:00.000+00:00",
        effective_status: "scheduled",
      },
      {
        slug: "kara-now",
        celebrity_slug: "kara",
        locale: "ko",
        title: "Now",
        starts_at: "2026-07-23T11:00:00.000+00:00",
        effective_status: "live",
      },
      {
        slug: "elina-upcoming",
        celebrity_slug: "elina",
        locale: "ko",
        title: "Elina upcoming",
        starts_at: "2026-07-25T11:00:00.000+00:00",
        effective_status: "scheduled",
      },
    ]);
    const client = { from: vi.fn(() => query) };
    const repository = new SupabasePublishedContentRepository(client);

    await expect(repository.listPrimaryLives("ko")).resolves.toEqual([
      expect.objectContaining({ slug: "kara-now" }),
      expect.objectContaining({ slug: "elina-upcoming" }),
    ]);
    expect(client.from).toHaveBeenCalledWith(
      "published_celebrity_live_summaries",
    );
    expect(query.order).toHaveBeenCalledWith("starts_at", { ascending: true });
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
