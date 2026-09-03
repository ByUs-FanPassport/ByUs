import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  JourneyRepositoryError,
  SupabaseJourneyRepository,
} from "./journey-repository";

const liveEventId = "11111111-1111-4111-8111-111111111111";
const requirementRevisionId = "22222222-2222-4222-8222-222222222222";
const missionId = "33333333-3333-4333-8333-333333333333";
const appUserId = "44444444-4444-4444-8444-444444444444";
const idempotencyKey = "55555555-5555-4555-8555-555555555555";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    liveEventId,
    requirementRevisionId,
    eligible: false,
    complete: false,
    requirements: {
      passport: { required: true, state: "complete" },
      reservation: { required: false, state: "incomplete" },
      attendance: { required: true, state: "incomplete" },
      missions: [{ missionId, version: 2, state: "complete" }],
    },
    bonusTicketAmount: 3,
    completedAt: null,
    ticketLedgerId: null,
    ...overrides,
  };
}

function completedSnapshot(overrides: Record<string, unknown> = {}) {
  return snapshot({
    eligible: true,
    complete: true,
    requirements: {
      ...snapshot().requirements,
      attendance: { required: true, state: "complete" },
    },
    completedAt: "2026-09-03T10:00:00.000Z",
    ticketLedgerId: "66666666-6666-4666-8666-666666666666",
    ...overrides,
  });
}

describe("SupabaseJourneyRepository", () => {
  it("reads only the authenticated owner's Journey without binding a preview", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null });
    const repository = new SupabaseJourneyRepository({ rpc });

    await expect(
      repository.getOwned({ appUserId, liveSlug: "kara-live" }),
    ).resolves.toEqual(snapshot());
    expect(rpc).toHaveBeenCalledWith("get_owned_live_journey", {
      p_app_user_id: appUserId,
      p_live_slug: "kara-live",
    });
  });

  it.each([0, 3, 5])(
    "projects an evaluated Journey with Ticket amount %i",
    async (bonusTicketAmount) => {
      const completed = completedSnapshot({
        bonusTicketAmount,
        ticketLedgerId:
          bonusTicketAmount === 0
            ? null
            : "66666666-6666-4666-8666-666666666666",
      });
      const rpc = vi.fn().mockResolvedValue({ data: completed, error: null });
      const repository = new SupabaseJourneyRepository({ rpc });

      await expect(
        repository.evaluateOwned({ appUserId, liveSlug: "kara-live", idempotencyKey }),
      ).resolves.toEqual(completed);
      expect(rpc).toHaveBeenCalledWith("evaluate_owned_live_journey", {
        p_app_user_id: appUserId,
        p_live_slug: "kara-live",
        p_idempotency_key: idempotencyKey,
      });
    },
  );

  it("returns the same authoritative completion for an exact replay", async () => {
    const completed = completedSnapshot();
    const rpc = vi.fn().mockResolvedValue({ data: completed, error: null });
    const repository = new SupabaseJourneyRepository({ rpc });

    const first = await repository.evaluateOwned({
      appUserId,
      liveSlug: "kara-live",
      idempotencyKey,
    });
    const replay = await repository.evaluateOwned({
      appUserId,
      liveSlug: "kara-live",
      idempotencyKey,
    });
    expect(replay).toEqual(first);
    expect(replay.requirementRevisionId).toBe(requirementRevisionId);
  });

  it("maps conflicting replay distinctly and redacts all other database errors", async () => {
    const conflict = new SupabaseJourneyRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "P3_JOURNEY_IDEMPOTENCY_CONFLICT secret" },
      }),
    });
    await expect(
      conflict.evaluateOwned({ appUserId, liveSlug: "kara-live", idempotencyKey }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<JourneyRepositoryError>>({
        code: "IDEMPOTENCY_CONFLICT",
      }),
    );

    const unavailable = new SupabaseJourneyRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "relation secret_table does not exist" },
      }),
    });
    await expect(
      unavailable.getOwned({ appUserId, liveSlug: "kara-live" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<JourneyRepositoryError>>({
        code: "JOURNEY_UNAVAILABLE",
        message: "JOURNEY_UNAVAILABLE",
      }),
    );
  });

  it("rejects malformed projections and owner/operational identifier leaks", async () => {
    for (const data of [
      { ...snapshot(), appUserId },
      { ...snapshot(), reservationId: "77777777-7777-4777-8777-777777777777" },
      { ...snapshot(), requirements: { ...snapshot().requirements, attendance: { required: true, state: "maybe" } } },
      { ...snapshot(), bonusTicketAmount: 6 },
    ]) {
      const repository = new SupabaseJourneyRepository({
        rpc: vi.fn().mockResolvedValue({ data, error: null }),
      });
      await expect(
        repository.getOwned({ appUserId, liveSlug: "kara-live" }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<JourneyRepositoryError>>({
          code: "JOURNEY_UNAVAILABLE",
        }),
      );
    }
  });
});
