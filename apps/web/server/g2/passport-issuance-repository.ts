import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  parseIssuanceAggregate,
  type IssuanceAggregate,
} from "../../features/passport/domain/issuance-aggregate";

export type IssuanceLocale = "ko" | "en";

export interface PassportIssuanceRepository {
  findOwnedIssuance(input: {
    passportId: string;
    ownerAppUserId: string;
    locale: IssuanceLocale;
  }): Promise<IssuanceAggregate | null>;
}

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export class SupabasePassportIssuanceRepository implements PassportIssuanceRepository {
  constructor(readonly client: RpcClient) {}

  async findOwnedIssuance(input: {
    passportId: string;
    ownerAppUserId: string;
    locale: IssuanceLocale;
  }): Promise<IssuanceAggregate | null> {
    const { data, error } = await this.client.rpc("get_owned_passport_issuance", {
      p_passport_id: input.passportId,
      p_app_user_id: input.ownerAppUserId,
      p_locale: input.locale,
    });
    if (error) throw new Error("Passport issuance query failed");
    if (data === null) return null;
    try {
      return parseIssuanceAggregate(data);
    } catch {
      throw new Error("Passport issuance projection is invalid");
    }
  }
}

export function createSupabasePassportIssuanceRepository(config: {
  url: string;
  serviceRoleKey: string;
}, client?: RpcClient): PassportIssuanceRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabasePassportIssuanceRepository(database as unknown as RpcClient);
}
