import "server-only";

import { unstable_cache } from "next/cache";

import {
  fetchTikTokLiveObservation,
  type TikTokLiveObservation,
} from "./tiktok-live-source";

export async function getCachedTikTokLiveObservation(
  handle: string,
): Promise<TikTokLiveObservation> {
  return unstable_cache(
    () => fetchTikTokLiveObservation(handle),
    ["observed-tiktok-live", handle],
    { revalidate: 30 },
  )();
}
