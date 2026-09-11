import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  recipientSaveResultSchema,
  type RecipientInput,
  type RecipientSaveResult,
} from "../../features/benefit/domain/fulfillment";

import { ownedRecipientDetailsSchema, type OwnedRecipientDetails } from "../../features/benefit/domain/raffle-result";

export interface BenefitFulfillmentRepository {
  readRecipient?(input: { appUserId: string; winnerId: string }): Promise<OwnedRecipientDetails | null>;
  saveRecipient(input: {
    appUserId: string;
    winnerId: string;
    correlationId: string;
    recipient: RecipientInput;
  }): Promise<RecipientSaveResult>;
}
type RpcClient = Pick<SupabaseClient, "rpc">;
export function createSupabaseBenefitFulfillmentRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): BenefitFulfillmentRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async readRecipient(input) {
      const { data, error } = await db.rpc("get_owned_benefit_recipient", { p_app_user_id: input.appUserId, p_winner_id: input.winnerId });
      if (error) throw new Error(error.message);
      return data === null ? null : ownedRecipientDetailsSchema.parse(data);
    },
    async saveRecipient(input) {
      const { data, error } = await db.rpc(input.recipient.phoneCountry !== undefined ? "save_owned_benefit_recipient_v2" : "save_owned_benefit_recipient", {
        p_app_user_id: input.appUserId,
        p_winner_id: input.winnerId,
        p_correlation_id: input.correlationId,
        p_consent_version: input.recipient.consentVersion,
        p_consented: input.recipient.consented,
        p_name: input.recipient.name,
        p_phone: input.recipient.phone,
        ...(input.recipient.phoneCountry !== undefined ? {
          p_phone_country: input.recipient.phoneCountry,
          p_shipping_country: input.recipient.shippingCountry ?? null,
          p_expected_revision: input.recipient.expectedRevision ?? null,
        } : {}),
        p_postal_code: input.recipient.postalCode ?? null,
        p_address1: input.recipient.address1 ?? null,
        p_address2: input.recipient.address2 ?? null,
      });
      if (error) throw new Error(error.message);
      return recipientSaveResultSchema.parse(data);
    },
  };
}
