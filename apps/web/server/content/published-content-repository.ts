import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  type ContentLocale,
  type PublishedCelebrity,
  type PublishedCelebrityLive,
  parsePublishedCelebrity,
  parsePublishedCelebrityLive,
} from "./content-domain";
import {
  createPublicImageRoleReader,
  type PublicImageRoleReader,
} from "../media/public-image-reader";

const PUBLIC_COLUMNS =
  "slug,locale,name,summary,image_url,image_alt,image_position,themes,social_links,display_order,fan_count,primary_role";

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
        "slug,celebrity_slug,locale,title,starts_at,effective_status,preview_kind,preview_duration_ms,preview_square_video_url,preview_square_poster_url",
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

export class PublicImagePublishedContentRepository
  implements PublishedContentRepository
{
  constructor(
    private readonly repository: PublishedContentRepository,
    private readonly images: PublicImageRoleReader,
  ) {}

  async list(locale: ContentLocale): Promise<readonly PublishedCelebrity[]> {
    const celebrities = await this.repository.list(locale);
    const photosBySlug = await this.images.readCelebrityPhotoSetsBySlug(
      celebrities.map(({ slug }) => slug),
    );
    return celebrities.map((celebrity) => {
      const photos = photosBySlug[celebrity.slug];
      return photos === undefined
        ? celebrity
        : { ...celebrity, image: { ...celebrity.image, photos } };
    });
  }

  async findBySlug(
    locale: ContentLocale,
    slug: string,
  ): Promise<PublishedCelebrity | null> {
    const celebrity = await this.repository.findBySlug(locale, slug);
    if (!celebrity) return null;
    const photos = (await this.images.readCelebrityPhotoSetsBySlug([celebrity.slug]))[
      celebrity.slug
    ];
    return photos === undefined
      ? celebrity
      : { ...celebrity, image: { ...celebrity.image, photos } };
  }

  async listPrimaryLives(
    locale: ContentLocale,
  ): Promise<readonly PublishedCelebrityLive[]> {
    const lives = await this.repository.listPrimaryLives(locale);
    const photosBySlug = await this.images.readLivePhotoSetsBySlug(
      lives.map(({ slug }) => slug),
    );
    return lives.map((live) => {
      const photos = photosBySlug[live.slug];
      return photos === undefined ? live : { ...live, photos };
    });
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
  const repository = new SupabasePublishedContentRepository(
    client as unknown as PublishedContentClient,
  );
  const images = createPublicImageRoleReader(
    { url, serviceRoleKey },
    client as SupabaseClient,
  );
  return new PublicImagePublishedContentRepository(repository, images);
}
