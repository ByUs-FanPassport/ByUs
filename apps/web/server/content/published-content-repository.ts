import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  type ContentLocale,
  type PublishedCelebrity,
  type PublishedCelebrityLive,
  parsePublishedCelebrity,
  parsePublishedCelebrityLive,
} from "./content-domain";

const PUBLIC_COLUMNS =
  "slug,locale,name,summary,image_url,image_alt,image_position,themes,social_links,display_order,fan_count";

type QueryResult = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}>;

interface PublishedQuery {
  select(columns: string): PublishedQuery;
  eq(column: string, value: string): PublishedQuery;
  order(column: string, options: { ascending: boolean }): QueryResult;
  maybeSingle(): QueryResult;
}

export interface PublishedContentClient {
  from(relation: string): PublishedQuery;
}

export interface PublishedContentRepository {
  list(locale: ContentLocale): Promise<readonly PublishedCelebrity[]>;
  findBySlug(locale: ContentLocale, slug: string): Promise<PublishedCelebrity | null>;
  listPrimaryLives(locale: ContentLocale): Promise<readonly PublishedCelebrityLive[]>;
}

export class SupabasePublishedContentRepository
  implements PublishedContentRepository
{
  constructor(private readonly client: PublishedContentClient) {}

  async list(locale: ContentLocale): Promise<readonly PublishedCelebrity[]> {
    const { data, error } = await this.client
      .from("published_celebrities")
      .select(PUBLIC_COLUMNS)
      .eq("locale", locale)
      .order("display_order", { ascending: true });

    if (error || !Array.isArray(data)) {
      throw new Error("Published content query failed");
    }

    try {
      return data
        .map(parsePublishedCelebrity)
        .sort((left, right) => left.displayOrder - right.displayOrder || left.slug.localeCompare(right.slug));
    } catch (cause) {
      throw new Error("Published content projection is invalid", { cause });
    }
  }

  async findBySlug(
    locale: ContentLocale,
    slug: string,
  ): Promise<PublishedCelebrity | null> {
    const { data, error } = await this.client
      .from("published_celebrities")
      .select(PUBLIC_COLUMNS)
      .eq("locale", locale)
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw new Error("Published content query failed");
    if (data === null) return null;
    try {
      return parsePublishedCelebrity(data);
    } catch (cause) {
      throw new Error("Published content projection is invalid", { cause });
    }
  }

  async listPrimaryLives(
    locale: ContentLocale,
  ): Promise<readonly PublishedCelebrityLive[]> {
    const { data, error } = await this.client
      .from("published_celebrity_live_summaries")
      .select(
        "slug,celebrity_slug,locale,title,starts_at,effective_status",
      )
      .eq("locale", locale)
      .order("starts_at", { ascending: true });

    if (error || !Array.isArray(data)) {
      throw new Error("Published LIVE summary query failed");
    }

    const parsed = data.map(parsePublishedCelebrityLive);
    const primary = new Map<string, PublishedCelebrityLive>();
    for (const live of parsed) {
      const current = primary.get(live.celebritySlug);
      if (
        !current ||
        (live.effectiveStatus === "live" &&
          current.effectiveStatus !== "live")
      ) {
        primary.set(live.celebritySlug, live);
      }
    }
    return [...primary.values()];
  }
}

export function createPublishedContentRepositoryFromEnvironment(
  source: Record<string, string | undefined> = process.env,
): PublishedContentRepository {
  const url = source.SUPABASE_URL;
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Published content repository is not configured");
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabasePublishedContentRepository(client as unknown as PublishedContentClient);
}
