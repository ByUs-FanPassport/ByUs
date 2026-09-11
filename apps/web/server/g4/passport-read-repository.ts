import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parsePassportCollection, type PassportCollection } from "../../features/passport/domain/passport-collection";
import { parsePassportDetailRecord, type PassportDetail } from "../../features/passport/domain/passport-detail";
import { passportLocaleSchema, type PassportLocale } from "../../features/passport/domain/passport-read-model";
import { parseStampDetail, type StampDetail } from "../../features/passport/domain/stamp-detail";
import { attachPassportGrowth } from "./passport-growth";
import { createPublicImageRoleReader, type PublicImageRoleReader } from "../media/public-image-reader";
import { SupabaseCreatorReactionBatchRepository } from "../reaction/creator-reaction-batch-repository";

export interface PassportReadRepository {
  findCollection(input: { appUserId: string; locale: PassportLocale; includeStages?: boolean }): Promise<PassportCollection>;
  findPassport(input: { id: string; appUserId: string; locale: PassportLocale; includeStages?: boolean }): Promise<PassportDetail | null>;
  findStamp(input: { id: string; appUserId: string; locale: PassportLocale }): Promise<StampDetail | null>;
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, string | readonly string[]>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

function oneRow(value: unknown): unknown | null {
  if (Array.isArray(value)) {
    if (value.length > 1) throw new Error("Owner projection returned multiple rows");
    return value[0] ?? null;
  }
  return value;
}

export class SupabasePassportReadRepository implements PassportReadRepository {
  constructor(readonly client: RpcClient) {}

  async findCollection(input: { appUserId: string; locale: PassportLocale; includeStages?: boolean }): Promise<PassportCollection> {
    const locale = passportLocaleSchema.parse(input.locale);
    const { data, error } = await this.client.rpc(input.includeStages ? "get_owned_passport_collection_with_stages" : "get_owned_passport_collection", { p_app_user_id: input.appUserId, p_locale: locale });
    if (error) throw new Error("Passport collection query failed");
    let passports: PassportCollection;
    try { passports = parsePassportCollection(data ?? [], locale); }
    catch { throw new Error("Passport collection projection is invalid"); }
    const reactions = new SupabaseCreatorReactionBatchRepository(this.client);
    const recorded = new Map<string, boolean>();
    const slugs = [...new Set(passports.map((passport) => passport.celebrity.slug))];
    // The existing owner-scoped batch contract accepts up to 50 creators.
    for (let offset = 0; offset < slugs.length; offset += 50) {
      const states = await reactions.findMany({ appUserId: input.appUserId, celebritySlugs: slugs.slice(offset, offset + 50) });
      for (const state of states) recorded.set(state.slug, state.reacted);
    }
    return passports.map((passport) => ({ ...passport, firstReactionRecorded: recorded.get(passport.celebrity.slug) === true }));
  }

  async findPassport(input: { id: string; appUserId: string; locale: PassportLocale; includeStages?: boolean }): Promise<PassportDetail | null> {
    const locale = passportLocaleSchema.parse(input.locale);
    const { data, error } = await this.client.rpc(input.includeStages ? "get_owned_passport_detail_with_stages" : "get_owned_passport_detail", { p_passport_id: input.id, p_app_user_id: input.appUserId, p_locale: locale });
    if (error) throw new Error("Passport detail query failed");
    const row = oneRow(data);
    if (row === null) return null;
    try { return attachPassportGrowth(parsePassportDetailRecord(row, locale)); }
    catch { throw new Error("Passport detail projection is invalid"); }
  }

  async findStamp(input: { id: string; appUserId: string; locale: PassportLocale }): Promise<StampDetail | null> {
    const locale = passportLocaleSchema.parse(input.locale);
    const { data, error } = await this.client.rpc("get_owned_stamp_detail", { p_stamp_id: input.id, p_app_user_id: input.appUserId, p_locale: locale });
    if (error) throw new Error("Stamp detail query failed");
    const row = oneRow(data);
    if (row === null) return null;
    try { return parseStampDetail(row, locale); }
    catch { throw new Error("Stamp detail projection is invalid"); }
  }
}

export class PublicImagePassportReadRepository implements PassportReadRepository {
  constructor(
    private readonly repository: PassportReadRepository,
    private readonly images: PublicImageRoleReader,
  ) {}

  async findCollection(input: { appUserId: string; locale: PassportLocale; includeStages?: boolean }): Promise<PassportCollection> {
    const passports = await this.repository.findCollection(input);
    const photosBySlug = await this.images.readCelebrityPhotoSetsBySlug(
      passports.map(({ celebrity }) => celebrity.slug),
    );
    return passports.map((passport) => {
      const photos = photosBySlug[passport.celebrity.slug];
      return photos === undefined
        ? passport
        : { ...passport, celebrity: { ...passport.celebrity, photos } };
    });
  }

  async findPassport(input: { id: string; appUserId: string; locale: PassportLocale; includeStages?: boolean }): Promise<PassportDetail | null> {
    const passport = await this.repository.findPassport(input);
    if (!passport) return null;
    const photos = (await this.images.readCelebrityPhotoSetsBySlug([passport.celebrity.slug]))[
      passport.celebrity.slug
    ];
    return photos === undefined
      ? passport
      : { ...passport, celebrity: { ...passport.celebrity, photos } };
  }

  async findStamp(input: { id: string; appUserId: string; locale: PassportLocale }): Promise<StampDetail | null> {
    const stamp = await this.repository.findStamp(input);
    if (!stamp) return null;
    const photos = (await this.images.readCelebrityPhotoSetsBySlug([stamp.celebrity.slug]))[
      stamp.celebrity.slug
    ];
    return photos === undefined
      ? stamp
      : { ...stamp, celebrity: { ...stamp.celebrity, photos } };
  }
}

export function createSupabasePassportReadRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): PassportReadRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new PublicImagePassportReadRepository(
    new SupabasePassportReadRepository(database as unknown as RpcClient),
    createPublicImageRoleReader(config, database as unknown as SupabaseClient),
  );
}
