import { acquisitionChannelSchema, type AcquisitionChannel } from "../../features/analytics/domain/acquisition-attribution";
import type { ProductEventName } from "../../features/analytics/domain/product-event";

export type AcquisitionFunnelEvent = {
  eventName: ProductEventName;
  appUserId: string | null;
  anonymousSessionHash: string | null;
  source: string;
  occurredAt: string;
  properties: Record<string, unknown>;
};

const stages = [
  ["acquisition", null],
  ["fanVerification", "passport_issued"],
  ["reservation", "reservation_completed"],
  ["attendance", "attendance_completed"],
  ["raffleEntry", "benefit_entered"],
] as const;
export type AcquisitionFunnelStage = (typeof stages)[number][0];

export type AcquisitionFunnelReport = {
  population: "identified_acquisition_cohort";
  steps: Array<{
    stage: AcquisitionFunnelStage;
    users: number;
    previousStepRate: number | null;
  }>;
  identifiedAcquisitionsByChannel: Record<AcquisitionChannel | "unknown", number>;
  anonymousLandingSessions: number;
};

const acquisitionSources = new Set([
  "acquisition.session_landing",
  "acquisition.identified_handoff",
]);

function eventTime(event: AcquisitionFunnelEvent): number {
  return Date.parse(event.occurredAt);
}

function channelOf(event: AcquisitionFunnelEvent): AcquisitionChannel | "unknown" {
  const parsed = acquisitionChannelSchema.safeParse(event.properties.channel);
  return parsed.success ? parsed.data : "unknown";
}

export function buildAcquisitionFunnelReport(events: AcquisitionFunnelEvent[]): AcquisitionFunnelReport {
  const valid = events.filter((event) => Number.isFinite(eventTime(event)));
  const acquisitions = valid
    .filter((event) => event.eventName === "creator_page_view" && event.appUserId && acquisitionSources.has(event.source))
    .sort((a, b) => eventTime(a) - eventTime(b));
  const firstAcquisitionByUser = new Map<string, AcquisitionFunnelEvent>();
  for (const event of acquisitions) {
    if (!firstAcquisitionByUser.has(event.appUserId!)) firstAcquisitionByUser.set(event.appUserId!, event);
  }

  const byUser = new Map<string, AcquisitionFunnelEvent[]>();
  for (const event of valid) {
    if (!event.appUserId) continue;
    const userEvents = byUser.get(event.appUserId) ?? [];
    userEvents.push(event);
    byUser.set(event.appUserId, userEvents);
  }

  let cohort = new Map(firstAcquisitionByUser);
  const stepCounts = [cohort.size];
  for (const [, eventName] of stages.slice(1)) {
    const next = new Map<string, AcquisitionFunnelEvent>();
    for (const [appUserId, previous] of cohort) {
      const match = (byUser.get(appUserId) ?? [])
        .filter((event) =>
          event.eventName === eventName &&
          event.source === "server.commit_projection" &&
          eventTime(event) >= eventTime(previous))
        .sort((a, b) => eventTime(a) - eventTime(b))[0];
      if (match) next.set(appUserId, match);
    }
    cohort = next;
    stepCounts.push(cohort.size);
  }

  const identifiedAcquisitionsByChannel = Object.fromEntries(
    [...acquisitionChannelSchema.options, "unknown"].map((channel) => [channel, 0]),
  ) as Record<AcquisitionChannel | "unknown", number>;
  for (const event of firstAcquisitionByUser.values()) identifiedAcquisitionsByChannel[channelOf(event)] += 1;

  const anonymousLandingSessions = new Set(
    valid
      .filter((event) => event.eventName === "creator_page_view" && !event.appUserId && event.anonymousSessionHash && event.source === "acquisition.session_landing")
      .map((event) => event.anonymousSessionHash!),
  ).size;

  return {
    population: "identified_acquisition_cohort",
    steps: stages.map(([stage], index) => ({
      stage,
      users: stepCounts[index],
      previousStepRate: index === 0 || stepCounts[index - 1] === 0
        ? null
        : stepCounts[index] / stepCounts[index - 1],
    })),
    identifiedAcquisitionsByChannel,
    anonymousLandingSessions,
  };
}
