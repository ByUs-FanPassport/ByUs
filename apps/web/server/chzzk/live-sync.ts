import "server-only";

import type { PublishedCelebrity } from "../content/content-domain";
import { parseCanonicalChzzkChannelUrl } from "@/features/live/domain/chzzk-live";
import { fetchChzzkLiveObservations, type ChzzkLiveScan } from "./live-source";
import type { ChzzkLiveRepository } from "./live-repository";

export async function syncChzzkLive(input: {
  celebrities: readonly PublishedCelebrity[];
  repository: ChzzkLiveRepository;
  clientId: string;
  clientSecret: string;
  observe?: typeof fetchChzzkLiveObservations;
  now?: () => Date;
}): Promise<{ complete: boolean; live: number; offline: number }> {
  const ids = [...new Set(input.celebrities.flatMap((celebrity) => celebrity.socialLinks
    .filter((link) => link.platform === "chzzk")
    .map((link) => parseCanonicalChzzkChannelUrl(link.url))
    .filter((value): value is string => value !== null)))];
  const scan: ChzzkLiveScan = await (input.observe ?? fetchChzzkLiveObservations)(ids, {
    clientId: input.clientId, clientSecret: input.clientSecret, now: input.now,
  });
  await input.repository.write(scan.complete ? scan.observations : scan.observations.filter((value) => value.state === "live"));
  return { complete: scan.complete, live: scan.observations.filter((value) => value.state === "live").length,
    offline: scan.complete ? scan.observations.filter((value) => value.state === "offline").length : 0 };
}
