import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  AnalyticsRepositoryError,
  SupabaseAnalyticsRepository,
  metricEnvelopeSchema,
} from "./analytics-repository";

const id = "11111111-1111-4111-8111-111111111111";
const window = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-08-01T00:00:00.000Z",
  semantics: "[from,to)",
  asOf: "2026-08-01T00:00:00.000Z",
};
const available = (value: unknown, source: string) => ({
  state: "available",
  value,
  reason: null,
  source,
});
const unavailable = (reason: string) => ({
  state: "unavailable",
  value: null,
  reason,
  source: null,
});
const notApplicable = (reason: string, source: string) => ({
  state: "not_applicable",
  value: null,
  reason,
  source,
});

describe("G5 analytics repository", () => {
  it("preserves zero, N/A, and unavailable as different metric states", () => {
    expect(metricEnvelopeSchema.parse(available(0, "source"))).toMatchObject({
      state: "available",
      value: 0,
    });
    expect(
      metricEnvelopeSchema.parse({
        state: "not_applicable",
        value: null,
        reason: "DENOMINATOR_ZERO",
        source: "source",
      }),
    ).toMatchObject({ state: "not_applicable", value: null });
    expect(
      metricEnvelopeSchema.parse(unavailable("SOURCE_NOT_IMPLEMENTED")),
    ).toMatchObject({ state: "unavailable", value: null });
  });

  it("calls the guarded creator RPC with canonical scope and times", async () => {
    const payload = {
      scope: { celebrityId: id, liveEventId: null },
      window,
      metrics: {
        reservationUsers: available(0, "live_reservations"),
        passportsIssued: available(0, "fan_passports"),
        levelDistribution: available(
          { bronze: 0, silver: 0, gold: 0, platinum: 0, diamond: 0, total: 0 },
          "fan_score_ledger",
        ),
        stampTypeCounts: available(
          { knowledge: 0, reservation: 0, attendance: 0, survey: 0, total: 0 },
          "stamps",
        ),
        reservationCount: available(0, "live_reservations"),
        attendanceCount: available(0, "live_attendances"),
        attendanceRate: notApplicable(
          "NO_RESERVATIONS_IN_WINDOW",
          "live_attendances/live_reservations",
        ),
        surveyResponseCount: available(0, "live_survey_responses(submitted)"),
        surveyCompletionRate: notApplicable(
          "NO_ATTENDANCES_IN_WINDOW",
          "live_survey_responses/live_attendances",
        ),
        surveyAggregates: notApplicable(
          "NO_SUBMITTED_SURVEYS",
          "live_survey_answers(common questions only)",
        ),
      },
    };
    const database = {
      rpc: vi.fn(async () => ({ data: payload, error: null })),
    };
    const repository = new SupabaseAnalyticsRepository(database);
    await expect(
      repository.readCreator({
        adminAppUserId: id,
        adminAllowlistId: id,
        celebrityId: id,
        from: window.from,
        to: window.to,
        asOf: window.asOf,
      }),
    ).resolves.toEqual(payload);
    expect(database.rpc).toHaveBeenCalledWith(
      "read_admin_creator_analytics",
      expect.objectContaining({
        p_actor_app_user_id: id,
        p_actor_admin_allowlist_id: id,
        p_celebrity_id: id,
        p_live_event_id: null,
      }),
    );
  });

  it("fails closed on malformed or rejected projections", async () => {
    await expect(
      new SupabaseAnalyticsRepository({
        rpc: async () => ({ data: { users: [id] }, error: null }),
      }).readCreator({
        adminAppUserId: id,
        adminAllowlistId: id,
        celebrityId: id,
        from: window.from,
        to: window.to,
        asOf: window.asOf,
      }),
    ).rejects.toBeInstanceOf(AnalyticsRepositoryError);
    await expect(
      new SupabaseAnalyticsRepository({
        rpc: async () => ({
          data: null,
          error: { message: "active administrator is required" },
        }),
      }).readBrand({
        adminAppUserId: id,
        adminAllowlistId: id,
        brandId: id,
        from: window.from,
        to: window.to,
        asOf: window.asOf,
      }),
    ).rejects.toBeInstanceOf(AnalyticsRepositoryError);
  });
});
