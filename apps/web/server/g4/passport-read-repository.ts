import "server-only";

import { createClient } from "@supabase/supabase-js";
import { parsePassportCollection, type PassportCollection } from "../../features/passport/domain/passport-collection";
import { parsePassportDetail, type PassportDetail } from "../../features/passport/domain/passport-detail";
import { passportLocaleSchema, type PassportLocale } from "../../features/passport/domain/passport-read-model";
import { parseStampDetail, type StampDetail } from "../../features/passport/domain/stamp-detail";

export interface PassportReadRepository {
  findCollection(input: { appUserId: string; locale: PassportLocale }): Promise<PassportCollection>;
  findPassport(input: { id: string; appUserId: string; locale: PassportLocale }): Promise<PassportDetail | null>;
  findStamp(input: { id: string; appUserId: string; locale: PassportLocale }): Promise<StampDetail | null>;
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
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

  async findCollection(input: { appUserId: string; locale: PassportLocale }): Promise<PassportCollection> {
    const locale = passportLocaleSchema.parse(input.locale);
    const { data, error } = await this.client.rpc("get_owned_passport_collection", { p_app_user_id: input.appUserId, p_locale: locale });
    if (error) throw new Error("Passport collection query failed");
    try { return parsePassportCollection(data ?? [], locale); }
    catch { throw new Error("Passport collection projection is invalid"); }
  }

  async findPassport(input: { id: string; appUserId: string; locale: PassportLocale }): Promise<PassportDetail | null> {
    const locale = passportLocaleSchema.parse(input.locale);
    const { data, error } = await this.client.rpc("get_owned_passport_detail", { p_passport_id: input.id, p_app_user_id: input.appUserId, p_locale: locale });
    if (error) throw new Error("Passport detail query failed");
    const row = oneRow(data);
    if (row === null) return null;
    try { return parsePassportDetail(row, locale); }
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

export function createSupabasePassportReadRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): PassportReadRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabasePassportReadRepository(database as unknown as RpcClient);
}
