import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { connectionSchema } from "./model";
import type { InstagramLiveObservation } from "./live-source";

const liveConnectionSchema = connectionSchema.omit({ lease_id: true }).extend({ live_lease_id: z.string().uuid() });
export type InstagramLiveConnection = z.infer<typeof liveConnectionSchema>;
export interface InstagramLiveRepository {
  claim(): Promise<InstagramLiveConnection[]>;
  finish(connection: InstagramLiveConnection, observation: InstagramLiveObservation): Promise<boolean>;
}
export function createInstagramLiveRepository(db: SupabaseClient): InstagramLiveRepository {
  return {
    async claim() {
      const { data, error } = await db.rpc("instagram_claim_live_sync", { p_limit: 25 });
      if (error) throw new Error("Instagram LIVE storage unavailable");
      return z.array(liveConnectionSchema).max(25).parse(data);
    },
    async finish(connection, observation) {
      const { data, error } = await db.rpc("instagram_finish_live_sync", {
        p_celebrity_id: connection.celebrity_id, p_generation: connection.generation,
        p_lease_id: connection.live_lease_id, p_token_issued_at: connection.token_issued_at,
        p_observation: observation,
      });
      if (error) throw new Error("Instagram LIVE storage unavailable");
      return z.boolean().parse(data);
    },
  };
}
