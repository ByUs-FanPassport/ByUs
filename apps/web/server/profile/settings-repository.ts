import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const profileRowSchema = z
  .object({ nickname: z.string().min(2).max(16) })
  .nullable();
const walletRowSchema = z
  .object({
    chain_id: z.coerce.number().int().positive(),
    address: z.string().regex(/^0x[0-9a-f]{40}$/),
  })
  .nullable();

export interface FanSettingsSummary {
  nickname: string;
  wallet: { chainId: number; maskedAddress: string } | null;
}

export interface SettingsRepository {
  get(appUserId: string): Promise<FanSettingsSummary>;
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
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export class SupabaseSettingsRepository implements SettingsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async get(appUserId: string): Promise<FanSettingsSummary> {
    const [profileResult, walletResult] = await Promise.all([
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
    ]);
    if (profileResult.error || walletResult.error)
      throw new Error("SETTINGS_UNAVAILABLE");
    const profile = profileRowSchema.parse(profileResult.data);
    const wallet = walletRowSchema.parse(walletResult.data);
    if (!profile) throw new Error("PROFILE_REQUIRED");
    return {
      nickname: profile.nickname,
      wallet: wallet
        ? {
            chainId: wallet.chain_id,
            maskedAddress: maskAddress(wallet.address),
          }
        : null,
    };
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
