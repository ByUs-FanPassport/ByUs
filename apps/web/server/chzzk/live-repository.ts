import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chzzkChannelIdSchema, chzzkLiveObservationSchema, type ChzzkLiveObservation } from "@/features/live/domain/chzzk-live";

type Row = { channel_id: string; state: "live" | "offline"; observed_at: string; title: string | null };

export interface ChzzkLiveRepository {
  write(observations: readonly ChzzkLiveObservation[]): Promise<void>;
  read(channelId: string, now?: () => Date): Promise<ChzzkLiveObservation>;
}

export function createChzzkLiveRepository(db: SupabaseClient): ChzzkLiveRepository {
  return {
    async write(observations) {
      const rows = observations.filter((value): value is Exclude<ChzzkLiveObservation, { state: "unavailable" }> => value.state !== "unavailable")
        .map<Row>((value) => ({ channel_id: value.channelId, state: value.state, observed_at: value.observedAt, title: value.state === "live" ? value.title : null }));
      if (!rows.length) return;
      const { error } = await db.from("chzzk_live_observations").upsert(rows, { onConflict: "channel_id" });
      if (error) throw new Error("CHZZK LIVE storage unavailable");
    },
    async read(channelId, now = () => new Date()) {
      const observedAt = now().toISOString();
      if (!chzzkChannelIdSchema.safeParse(channelId).success) return { state: "unavailable", channelId, observedAt } as ChzzkLiveObservation;
      const { data, error } = await db.from("chzzk_live_observations").select("channel_id,state,observed_at,title").eq("channel_id", channelId).maybeSingle();
      if (error || !data || typeof data !== "object") return { state: "unavailable", channelId, observedAt };
      const row = data as Partial<Row>;
      const parsed = chzzkLiveObservationSchema.safeParse(row.state === "live"
        ? { state: "live", channelId: row.channel_id, observedAt: row.observed_at, title: row.title }
        : { state: "offline", channelId: row.channel_id, observedAt: row.observed_at });
      return parsed.success ? parsed.data : { state: "unavailable", channelId, observedAt };
    },
  };
}
