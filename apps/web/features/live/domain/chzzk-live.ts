import { z } from "zod";

export const CHZZK_LIVE_MAX_AGE_MS = 180_000;

export const chzzkChannelIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const observedAtSchema = z.iso.datetime({ offset: true });

export function parseCanonicalChzzkChannelUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = /^\/(?:live\/)?([a-f0-9]{32})\/?$/.exec(url.pathname);
    return url.protocol === "https:" && url.hostname === "chzzk.naver.com" &&
      url.port === "" && url.username === "" && url.password === "" &&
      url.search === "" && url.hash === "" && match ? match[1]! : null;
  } catch { return null; }
}

export function toChzzkLiveWatchUrl(channelId: string): string {
  return `https://chzzk.naver.com/live/${chzzkChannelIdSchema.parse(channelId)}`;
}

const offlineObservationSchema = z.object({
  state: z.literal("offline"), channelId: chzzkChannelIdSchema, observedAt: observedAtSchema,
}).strict();
const unavailableObservationSchema = z.object({
  state: z.literal("unavailable"), channelId: chzzkChannelIdSchema, observedAt: observedAtSchema,
}).strict();
const liveObservationSchema = z.object({
  state: z.literal("live"), channelId: chzzkChannelIdSchema, observedAt: observedAtSchema,
  title: z.string().trim().min(1).max(160),
}).strict();

export const chzzkLiveObservationSchema = z.union([
  liveObservationSchema, offlineObservationSchema, unavailableObservationSchema,
]);
export type ChzzkLiveObservation = z.infer<typeof chzzkLiveObservationSchema>;
