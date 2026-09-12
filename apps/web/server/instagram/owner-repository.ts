import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { connectionSchema } from "./model";
import { ownerAccountSchema, ownerFlowSchema, type OwnerAccount } from "./owner-model";

export function createInstagramOwnerRepository(db: SupabaseClient) {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      const known = ["OWNER_ACCOUNT_MISMATCH", "OWNER_CONFLICT", "OWNER_STALE", "OWNER_FLOW", "OWNER_REVOKED"]
        .find((code) => error.message.includes(code));
      if (known) throw new Error(known);
      throw new Error("Instagram owner storage unavailable");
    }
    return data;
  }
  return {
    transition(operation: string, hash: string, actor: string | null, browserHash: string, payload: Record<string, unknown> = {}) {
      return rpc("instagram_owner_transition", {
        p_operation: operation, p_secret_hash: hash, p_actor_app_user_id: actor,
        p_browser_hash: browserHash, p_payload: payload,
      }).then((data) => ownerFlowSchema.parse(data));
    },
    accounts(actor: string, locale: "ko" | "en"): Promise<OwnerAccount[]> {
      return rpc("instagram_owner_accounts", { p_actor_app_user_id: actor, p_locale: locale })
        .then((data) => z.array(ownerAccountSchema).parse(data));
    },
    settings(actor: string, input: { celebrityId: string; generation: string; liveEnabled: boolean; locale: "ko" | "en" }) {
      return rpc("instagram_owner_settings", {
        p_actor_app_user_id: actor, p_celebrity_id: input.celebrityId, p_generation: input.generation,
        p_live_enabled: input.liveEnabled, p_locale: input.locale,
      }).then((data) => ownerAccountSchema.parse(data));
    },
    disconnect(actor: string, celebrityId: string, generation: string) {
      return rpc("instagram_owner_disconnect", {
        p_actor_app_user_id: actor, p_celebrity_id: celebrityId, p_generation: generation,
      }).then((data) => z.object({
        celebrity_id: z.string().uuid(), identity: connectionSchema.shape.identity.nullable(), token_ciphertext: z.string().nullable(),
      }).parse(data));
    },
    expire(celebrityId: string, generation: string) {
      return rpc("instagram_expire_credentials", { p_celebrity_id: celebrityId, p_generation: generation })
        .then((data) => z.boolean().parse(data));
    },
  };
}
export type InstagramOwnerRepository = ReturnType<typeof createInstagramOwnerRepository>;
