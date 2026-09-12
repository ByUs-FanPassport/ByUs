import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../config/env";
import { instagramLiveObservationSchema, type InstagramLiveObservation } from "../../features/live/domain/instagram-live";

export type InstagramLiveObserver = (creatorSlug: string, username: string) => Promise<InstagramLiveObservation>;

/** Read-only projection: this path never loads an encrypted token or the token vault. */
export function createInstagramLiveReader(db: Pick<SupabaseClient, "rpc">, enabled: boolean, now = () => new Date()): InstagramLiveObserver {
  return async (creatorSlug, username) => {
    const unavailable = { state: "unavailable", observedAt: now().toISOString() } as const;
    if (!enabled) return unavailable;
    try {
      const { data, error } = await db.rpc("instagram_read_live_observation", { p_creator_slug: creatorSlug, p_username: username });
      if (error) return unavailable;
      const result = instagramLiveObservationSchema.safeParse(data);
      return result.success ? result.data : unavailable;
    } catch { return unavailable; }
  };
}

export function createCachedInstagramLiveObserver(input: { url: string; serviceRoleKey: string }): InstagramLiveObserver {
  const db = createClient(input.url, input.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return createInstagramLiveReader(db, process.env.INSTAGRAM_INTEGRATION_ENABLED === "true");
}


export type InstagramLiveDiscoveryObserver = InstagramLiveObserver;

/** Same public shape for disabled, disconnected and unavailable accounts. */
export function createInstagramLiveDiscoveryReader(db: Pick<SupabaseClient, "rpc">, enabled: boolean, now = () => new Date()): InstagramLiveDiscoveryObserver {
  return async (creatorSlug, username) => {
    const unavailable = { state: "unavailable", observedAt: now().toISOString() } as const;
    if (!enabled) return unavailable;
    try {
      const { data, error } = await db.rpc("instagram_read_live_discovery", { p_creator_slug: creatorSlug, p_username: username });
      if (error) return unavailable;
      const result = instagramLiveObservationSchema.safeParse(data);
      if (!result.success || (result.data.state === "live" && result.data.username !== username)) return unavailable;
      return result.data;
    } catch { return unavailable; }
  };
}
let discoveryReader: InstagramLiveDiscoveryObserver | undefined;
export async function getCachedInstagramLiveDiscoveryObservation(creatorSlug: string, username: string): Promise<InstagramLiveObservation> {
  const unavailable = { state: "unavailable", observedAt: new Date().toISOString() } as const;
  if (process.env.INSTAGRAM_INTEGRATION_ENABLED !== "true") return unavailable;
  try {
    if (!discoveryReader) {
      const env = loadServerEnv();
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      discoveryReader = createInstagramLiveDiscoveryReader(db, true);
    }
    return await discoveryReader(creatorSlug, username);
  } catch { return unavailable; }
}
