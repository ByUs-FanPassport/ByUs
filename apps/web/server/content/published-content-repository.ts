import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  type ContentLocale,
  type PublishedCelebrity,
  parsePublishedCelebrity,
} from "./content-domain";

const PUBLIC_COLUMNS =
  "slug,locale,name,summary,image_url,image_alt,image_position,themes,social_links";

type QueryResult = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}>;

interface PublishedQuery {
  select(columns: string): PublishedQuery;
  eq(column: string, value: string): PublishedQuery;
  order(column: string, options: { ascending: boolean }): QueryResult;
}

export interface PublishedContentClient {
  from(relation: string): PublishedQuery;
}

export interface PublishedContentRepository {
  list(locale: ContentLocale): Promise<readonly PublishedCelebrity[]>;
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
      .order("slug", { ascending: true });

    if (error || !Array.isArray(data)) {
      throw new Error("Published content query failed");
    }

    try {
      return data.map(parsePublishedCelebrity);
    } catch (cause) {
      throw new Error("Published content projection is invalid", { cause });
    }
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
