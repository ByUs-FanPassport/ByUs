import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RecipientInput } from "../../features/benefit/domain/fulfillment";

export interface BenefitFulfillmentRepository {
  saveRecipient(input: {
    appUserId: string;
    winnerId: string;
    correlationId: string;
    recipient: RecipientInput;
  }): Promise<Record<string, unknown>>;
}
type RpcClient = Pick<SupabaseClient, "rpc">;
export function createSupabaseBenefitFulfillmentRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): BenefitFulfillmentRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async saveRecipient(input) {
      const { data, error } = await db.rpc("save_owned_benefit_recipient", {
        p_app_user_id: input.appUserId,
        p_winner_id: input.winnerId,
        p_correlation_id: input.correlationId,
        p_consent_version: input.recipient.consentVersion,
        p_consented: input.recipient.consented,
        p_name: input.recipient.name,
        p_phone: input.recipient.phone,
        p_postal_code: input.recipient.postalCode ?? null,
        p_address1: input.recipient.address1 ?? null,
        p_address2: input.recipient.address2 ?? null,
      });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>;
    },
  };
}
