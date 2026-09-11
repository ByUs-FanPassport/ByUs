import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from }) }));
import { loadSitemapContent } from "./sitemap-content";

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  from.mockReset();
});

it("paginates URL-only reads and requires public parents and every translation on LIVE queries", async () => {
  const reads: { relation: string; columns: string; filters: Record<string, string>; ranges: number[][] }[] = [];
  from.mockImplementation((relation: string) => {
    const read = { relation, columns: "", filters: {} as Record<string, string>, ranges: [] as number[][] };
    reads.push(read);
    const query = {
      select(columns: string) { read.columns = columns; return query; },
      eq(key: string, value: string) { read.filters[key] = value; return query; },
      order() { return query; },
      async range(start: number, end: number) {
        read.ranges.push([start, end]);
        return { data: relation === "published_celebrities" && start === 0
          ? Array.from({ length: 500 }, (_, index) => ({ slug: `creator-${index}` }))
          : [{ slug: relation === "live_events" ? "ended-event" : "last-creator" }], error: null };
      },
    };
    return query;
  });
  const pages = await loadSitemapContent();
  expect(pages).toHaveLength(1004);
  expect(reads.filter(({ relation }) => relation === "published_celebrities").some(({ ranges }) => ranges[0]?.[0] === 500)).toBe(true);
  for (const read of reads.filter(({ relation }) => relation === "live_events")) {
    expect(read.columns).not.toMatch(/viewer|reservation|recipient|fan_code/);
    expect(read.filters).toMatchObject({ publication_status: "published", "celebrities.status": "published", "brands.status": "published" });
    const locale = read.filters["live_event_localizations.locale"];
    expect(read.filters["celebrities.celebrity_localizations.locale"]).toBe(locale);
    expect(read.filters["brands.brand_localizations.locale"]).toBe(locale);
  }
});

it("fails closed instead of returning a success sitemap with partial content", async () => {
  const query = { select: () => query, eq: () => query, order: () => query, range: async () => ({ data: null, error: { message: "unavailable" } }) };
  from.mockReturnValue(query);
  await expect(loadSitemapContent()).rejects.toThrow("Sitemap creator query failed");
});
