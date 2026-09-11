import "server-only";

import { z } from "zod";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const rowSchema = z.object({
  slug: slugSchema,
  celebrities: z.object({
    slug: slugSchema,
    image_position: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

export type CalendarCreatorImage = Readonly<{
  celebritySlug: string;
  imagePosition: string;
}>;

export interface CalendarCreatorImageLookup {
  readByLiveSlugs(slugs: readonly string[]): Promise<Record<string, CalendarCreatorImage>>;
}

interface LiveEventQuery {
  select(columns: string): LiveEventQuery;
  in(column: string, values: readonly string[]): LiveEventQuery;
  eq(column: string, value: string): LiveEventQuery;
  is(column: string, value: null): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface CalendarCreatorImageClient {
  from(relation: "live_events"): LiveEventQuery;
}

/** Resolves only the public creator identity associated with already-public calendar LIVE slugs. */
export class SupabaseCalendarCreatorImageLookup implements CalendarCreatorImageLookup {
  constructor(private readonly client: CalendarCreatorImageClient) {}

  async readByLiveSlugs(slugs: readonly string[]): Promise<Record<string, CalendarCreatorImage>> {
    const unique = [...new Set(z.array(slugSchema).max(200).parse(slugs))];
    if (unique.length === 0) return {};
    const { data, error } = await this.client
      .from("live_events")
      .select("slug,celebrities!inner(slug,image_position)")
      .in("slug", unique)
      .eq("publication_status", "published")
      .eq("celebrities.status", "published")
      .is("archived_at", null);
    if (error) throw new Error("calendar creator image lookup failed");
    const rows = z.array(rowSchema).parse(data);
    const results: Record<string, CalendarCreatorImage> = {};
    for (const row of rows) {
      if (results[row.slug]) throw new Error("duplicate calendar LIVE creator image");
      results[row.slug] = {
        celebritySlug: row.celebrities.slug,
        imagePosition: row.celebrities.image_position,
      };
    }
    return results;
  }
}
