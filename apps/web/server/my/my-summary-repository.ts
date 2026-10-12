import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ownerMySummarySchema, prioritizeReservedLives, type MySummary, type OwnerMySummary } from "../../features/my/domain/my-summary";
import { SupabasePublishedContentRepository, type PublishedContentClient } from "../content/published-content-repository";
import { createPublicImageRoleReader, type PublicImageRoleReader } from "../media/public-image-reader";

interface RpcClient {
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface MySummaryRepository {
  get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<MySummary>;
}

interface OwnerMySummaryRepository {
  get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<OwnerMySummary>;
}

interface PublicCreatorDirectory {
  list(locale: "ko" | "en"): Promise<readonly { slug: string }[]>;
}

export class SupabaseMySummaryRepository implements OwnerMySummaryRepository {
  constructor(private readonly client: RpcClient) {}
  async get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<OwnerMySummary> {
    const { data, error } = await this.client.rpc(input.includeStages ? "get_owned_my_fan_activity_with_stages" : "get_owned_my_fan_activity", {
      p_app_user_id: input.appUserId,
      p_locale: input.locale,
      p_as_of: input.asOf.toISOString(),
    });
    if (error) throw new Error("MY summary query failed");
    let summary: OwnerMySummary;
    try { summary = ownerMySummarySchema.parse(data); }
    catch { throw new Error("MY summary projection is invalid"); }
    const upcoming = prioritizeReservedLives(summary.live.upcoming, input.asOf.getTime());
    const upcomingIds = new Set(upcoming.map((event) => event.id));
    // Open-ended recurring schedules can stay scheduled after their start; preserve them as history.
    const history = [...summary.live.history, ...summary.live.upcoming.filter((event) => !upcomingIds.has(event.id))]
      .toSorted((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt) || right.id.localeCompare(left.id));
    return { ...summary, live: { upcoming, history } };
  }
}

export class PublicImageMySummaryRepository implements MySummaryRepository {
  constructor(
    private readonly repository: OwnerMySummaryRepository,
    private readonly images: PublicImageRoleReader,
    private readonly published: PublicCreatorDirectory,
  ) {}

  async get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<MySummary> {
    const summary = await this.repository.get(input);
    if (summary.creators.length === 0) return { ...summary, creators: [] };
    const slugs = summary.creators.map(({ celebrity }) => celebrity.slug);
    const [photosBySlug, publicCreators] = await Promise.all([
      this.images.readCelebrityPhotoSetsBySlug(slugs),
      this.published.list(input.locale),
    ]);
    const publicSlugs = new Set(publicCreators.map(({ slug }) => slug));
    return {
      ...summary,
      creators: summary.creators.map((creator) => {
        const photos = photosBySlug[creator.celebrity.slug];
        return {
          ...creator,
          celebrity: {
            ...creator.celebrity,
            ...(photos === undefined ? {} : { photos }),
            isPublic: publicSlugs.has(creator.celebrity.slug),
          },
        };
      }),
    };
  }
}

export function createSupabaseMySummaryRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): MySummaryRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new PublicImageMySummaryRepository(
    new SupabaseMySummaryRepository(database as unknown as RpcClient),
    createPublicImageRoleReader(config, database as unknown as SupabaseClient),
    new SupabasePublishedContentRepository(database as unknown as PublishedContentClient),
  );
}
