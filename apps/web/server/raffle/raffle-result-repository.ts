import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ownedRaffleListSchema, ownedRaffleResultSchema, type OwnedRaffleList, type OwnedRaffleResult } from "../../features/benefit/domain/raffle-result";

export interface RaffleResultRepository {
  find(input: { appUserId: string; benefitId: string; locale: "ko" | "en" }): Promise<OwnedRaffleResult | null>;
  list(input: { appUserId: string; locale: "ko" | "en"; cursor: string | null }): Promise<OwnedRaffleList>;
}

export function createSupabaseRaffleResultRepository(config: { url: string; serviceRoleKey: string }, client?: Pick<SupabaseClient, "rpc">): RaffleResultRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async find(input) {
      const { data, error } = await db.rpc("get_owned_raffle_result", {
        p_app_user_id: input.appUserId, p_benefit_id: input.benefitId, p_locale: input.locale,
      });
      if (error) throw new Error("RAFFLE_RESULT_UNAVAILABLE");
      return data === null ? null : ownedRaffleResultSchema.parse(data);
    },
    async list(input) {
      const { data, error } = await db.rpc("get_owned_raffles", {
        p_app_user_id: input.appUserId, p_locale: input.locale, p_cursor: input.cursor, p_limit: 20,
      });
      if (error) throw new Error("RAFFLE_RESULT_UNAVAILABLE");
      return ownedRaffleListSchema.parse(data);
    },
  };
}
