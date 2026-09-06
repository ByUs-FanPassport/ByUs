import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  preferredLocaleSchema,
  type PreferredLocale,
} from "../../features/profile/domain/preferred-locale";

const profileRowSchema = z
  .object({ nickname: z.string().min(2).max(16) })
  .nullable();
const walletRowSchema = z
  .object({
    chain_id: z.coerce.number().int().positive(),
    address: z.string().regex(/^0x[0-9a-f]{40}$/),
  })
  .nullable();
const appUserRowSchema = z
  .object({ preferred_locale: preferredLocaleSchema.nullable() })
  .nullable();

export interface FanSettingsSummary {
  nickname: string;
  preferredLocale: PreferredLocale;
  wallet: { chainId: number; maskedAddress: string } | null;
}

export interface SettingsRepository {
  get(appUserId: string): Promise<FanSettingsSummary>;
  setPreferredLocale(
    appUserId: string,
    locale: PreferredLocale,
  ): Promise<PreferredLocale>;
}

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}
interface QueryBuilder {
  select(columns: string): QueryBuilder;
  eq(column: string, value: string | number): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
}
interface DatabaseClient {
  from(table: string): QueryBuilder;
  rpc(
    name: string,
    parameters: Record<string, string | number | boolean>,
  ): PromiseLike<QueryResult>;
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export class SupabaseSettingsRepository implements SettingsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async get(appUserId: string): Promise<FanSettingsSummary> {
    const [profileResult, walletResult, appUserResult] = await Promise.all([
      this.database
        .from("user_profiles")
        .select("nickname")
        .eq("app_user_id", appUserId)
        .maybeSingle(),
      this.database
        .from("user_wallets")
        .select("chain_id,address")
        .eq("app_user_id", appUserId)
        .order("chain_id", { ascending: true })
        .limit(1)
        .maybeSingle(),
      this.database
        .from("app_users")
        .select("preferred_locale")
        .eq("id", appUserId)
        .maybeSingle(),
    ]);
    if (profileResult.error || walletResult.error || appUserResult.error)
      throw new Error("SETTINGS_UNAVAILABLE");
    const profile = profileRowSchema.parse(profileResult.data);
    const wallet = walletRowSchema.parse(walletResult.data);
    const appUser = appUserRowSchema.parse(appUserResult.data);
    if (!profile) throw new Error("PROFILE_REQUIRED");
    if (!appUser) throw new Error("SETTINGS_UNAVAILABLE");
    return {
      nickname: profile.nickname,
      preferredLocale: appUser.preferred_locale ?? "ko",
      wallet: wallet
        ? {
            chainId: wallet.chain_id,
            maskedAddress: maskAddress(wallet.address),
          }
        : null,
    };
  }

  async setPreferredLocale(
    appUserId: string,
    locale: PreferredLocale,
  ): Promise<PreferredLocale> {
    const result = await this.database.rpc("set_owned_preferred_locale", {
      p_app_user_id: appUserId,
      p_locale: locale,
    });
    if (result.error) throw new Error("SETTINGS_UNAVAILABLE");
    return preferredLocaleSchema.parse(result.data);
  }
}

export function createSupabaseSettingsRepository(config: {
  url: string;
  serviceRoleKey: string;
}): SettingsRepository {
  const database = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseSettingsRepository(database as unknown as DatabaseClient);
}
