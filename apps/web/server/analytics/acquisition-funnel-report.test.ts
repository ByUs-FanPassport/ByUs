import { describe, expect, it } from "vitest";

import {
  buildAcquisitionFunnelReport,
  type AcquisitionFunnelEvent,
} from "./acquisition-funnel-report";

const ids = {
  complete: "11111111-1111-4111-8111-111111111111",
  partial: "22222222-2222-4222-8222-222222222222",
  invalidOrder: "33333333-3333-4333-8333-333333333333",
};

function event(
  appUserId: string | null,
  eventName: AcquisitionFunnelEvent["eventName"],
  minute: number,
  source = "server.commit_projection",
  properties: Record<string, unknown> = {},
): AcquisitionFunnelEvent {
  return {
    eventName,
    appUserId,
    anonymousSessionHash: appUserId ? null : `hash-${minute}`,
    source,
    occurredAt: `2026-09-11T00:${String(minute).padStart(2, "0")}:00.000Z`,
    properties,
  };
}

describe("acquisition funnel report", () => {
  it("uses an identified cohort and only ordered server-committed completions", () => {
    const events = [
      event(ids.complete, "creator_page_view", 1, "acquisition.identified_handoff", { channel: "social" }),
      event(ids.complete, "passport_issued", 2),
      event(ids.complete, "reservation_completed", 3),
      event(ids.complete, "attendance_completed", 4),
      event(ids.complete, "benefit_entered", 5),
      event(ids.partial, "creator_page_view", 1, "acquisition.session_landing", { channel: "search" }),
      event(ids.partial, "passport_issued", 2),
      event(ids.partial, "reservation_completed", 3, "fan.client.forged"),
      event(ids.invalidOrder, "passport_issued", 1),
      event(ids.invalidOrder, "creator_page_view", 2, "acquisition.session_landing", { channel: "email" }),
      event(ids.invalidOrder, "reservation_completed", 3),
      event(null, "creator_page_view", 1, "acquisition.session_landing", { channel: "referral" }),
      event(null, "creator_page_view", 2, "acquisition.session_landing", { channel: "referral" }),
    ];

    const report = buildAcquisitionFunnelReport(events);
    expect(report.population).toBe("identified_acquisition_cohort");
    expect(report.steps.map(({ users }) => users)).toEqual([3, 2, 1, 1, 1]);
    expect(report.steps.map(({ previousStepRate }) => previousStepRate)).toEqual([
      null,
      2 / 3,
      1 / 2,
      1,
      1,
    ]);
    expect(report.identifiedAcquisitionsByChannel).toMatchObject({ social: 1, search: 1, email: 1 });
    expect(report.anonymousLandingSessions).toBe(2);
  });

  it("does not claim rates when a prior step has no users", () => {
    const report = buildAcquisitionFunnelReport([]);
    expect(report.steps.every((step) => step.users === 0 && step.previousStepRate === null)).toBe(true);
  });
});
