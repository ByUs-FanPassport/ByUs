import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mySummarySchema, type MySummary } from "../../features/my/domain/my-summary";
import { createPublicImageRoleReader, type PublicImageRoleReader } from "../media/public-image-reader";

interface RpcClient {
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface MySummaryRepository {
  get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<MySummary>;
}

export class SupabaseMySummaryRepository implements MySummaryRepository {
  constructor(private readonly client: RpcClient) {}
  async get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<MySummary> {
    const { data, error } = await this.client.rpc(input.includeStages ? "get_owned_my_fan_activity_with_stages" : "get_owned_my_fan_activity", {
      p_app_user_id: input.appUserId,
      p_locale: input.locale,
      p_as_of: input.asOf.toISOString(),
    });
    if (error) throw new Error("MY summary query failed");
    try { return mySummarySchema.parse(data); }
    catch { throw new Error("MY summary projection is invalid"); }
  }
}

export class PublicImageMySummaryRepository implements MySummaryRepository {
  constructor(
    private readonly repository: MySummaryRepository,
    private readonly images: PublicImageRoleReader,
  ) {}

  async get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date; includeStages?: boolean }): Promise<MySummary> {
    const summary = await this.repository.get(input);
    const photosBySlug = await this.images.readCelebrityPhotoSetsBySlug(
      summary.creators.map(({ celebrity }) => celebrity.slug),
    );
    return {
      ...summary,
      creators: summary.creators.map((creator) => {
        const photos = photosBySlug[creator.celebrity.slug];
        return photos === undefined
          ? creator
          : { ...creator, celebrity: { ...creator.celebrity, photos } };
      }),
    };
  }
}

export function createSupabaseMySummaryRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): MySummaryRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new PublicImageMySummaryRepository(
    new SupabaseMySummaryRepository(database as unknown as RpcClient),
    createPublicImageRoleReader(config, database as unknown as SupabaseClient),
  );
}
