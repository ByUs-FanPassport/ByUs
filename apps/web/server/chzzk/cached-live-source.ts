import "server-only";

import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../config/env";
import type { ChzzkLiveObservation } from "@/features/live/domain/chzzk-live";
import { createChzzkLiveRepository } from "./live-repository";

export type ChzzkLiveObserver = (channelId: string) => Promise<ChzzkLiveObservation>;
let reader: ChzzkLiveObserver | undefined;

export async function getCachedChzzkLiveObservation(channelId: string): Promise<ChzzkLiveObservation> {
  const unavailable = { state: "unavailable" as const, channelId, observedAt: new Date().toISOString() };
  if (process.env.CHZZK_LIVE_ENABLED !== "true") return unavailable;
  try {
    if (!reader) {
      const env = loadServerEnv();
      const repository = createChzzkLiveRepository(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
      reader = (id) => repository.read(id);
    }
    return await reader(channelId);
  } catch { return unavailable; }
}
