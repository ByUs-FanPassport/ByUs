import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseLiveManagerRepository } from "./live-manager-repository";

describe("LiveManagerRepository", () => {
  it("writes the canonical provider and external LIVE URL through v3", async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: { id: "33333333-3333-4333-8333-333333333333" },
      error: null,
    }));
    const repository = createSupabaseLiveManagerRepository(
      { url: "https://supabase.example", serviceRoleKey: "test" },
      { rpc } as never,
    );

    await repository.save(
      {
        appUserId: "11111111-1111-4111-8111-111111111111",
        allowlistId: "22222222-2222-4222-8222-222222222222",
      },
      "44444444-4444-4444-8444-444444444444",
      {
        id: null,
        slug: "artist-live",
        celebrityId: "55555555-5555-4555-8555-555555555555",
        brandId: "66666666-6666-4666-8666-666666666666",
        startsAt: "2026-09-10T10:00:00Z",
        endsAt: "2026-09-10T11:00:00Z",
        reservationOpensAt: "2026-09-09T10:00:00Z",
        reservationClosesAt: "2026-09-10T10:00:00Z",
        liveProvider: "instagram",
        externalLiveUrl: "https://www.instagram.com/example/live/",
        heroUrl: "/hero.jpg",
        titleKo: "제목",
        summaryKo: "요약",
        heroAltKo: "이미지",
        titleEn: "Title",
        summaryEn: "Summary",
        heroAltEn: "Image",
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "save_admin_live_draft_v3",
      expect.objectContaining({
        p_live_provider: "instagram",
        p_external_live_url: "https://www.instagram.com/example/live/",
      }),
    );
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_youtube_url");
  });

  it("calls only the audited reschedule RPC with actor, correlation, expected revision, and all windows", async () => {
    const rpc = vi.fn(async () => ({ data: { revisionId: "77777777-7777-4777-8777-777777777777", revision: 3 }, error: null }));
    const repository = createSupabaseLiveManagerRepository(
      { url: "https://supabase.example", serviceRoleKey: "test" },
      { rpc } as never,
    );
    const actor = { appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222" };
    const input = {
      liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 2,
      reason: "Artist travel requires a later broadcast window", reservationOpensAt: "2026-09-09T01:00:00.000Z",
      reservationClosesAt: "2026-09-10T09:00:00.000Z", startsAt: "2026-09-10T10:00:00.000Z",
      endsAt: "2026-09-10T11:00:00.000Z", attendanceValidFrom: "2026-09-10T09:55:00.000Z",
      attendanceValidUntil: "2026-09-10T11:05:00.000Z",
    };

    await repository.reschedule(actor, "55555555-5555-4555-8555-555555555555", input);
    expect(rpc).toHaveBeenCalledWith("reschedule_admin_live", {
      p_actor_app_user_id: actor.appUserId,
      p_actor_admin_allowlist_id: actor.allowlistId,
      p_correlation_id: "55555555-5555-4555-8555-555555555555",
      p_live_event_id: input.liveEventId,
      p_expected_revision: 2,
      p_reason: input.reason,
      p_reservation_opens_at: input.reservationOpensAt,
      p_reservation_closes_at: input.reservationClosesAt,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_attendance_valid_from: input.attendanceValidFrom,
      p_attendance_valid_until: input.attendanceValidUntil,
    });
  });

  it("keeps the legacy draft writer on save_admin_live_draft_v3", async () => {
    const source = readFileSync(resolve(process.cwd(), "server/g5/live-manager-repository.ts"), "utf8");
    expect(source).toContain('db.rpc("save_admin_live_draft_v3"');
  });

  it("defines an append-only, locked schedule revision contract that preserves reservations", () => {
    const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260903016800_phase3_live_schedule_revisions.sql"), "utf8");
    expect(sql).toContain("live_schedule_revisions");
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/expected_revision/i);
    expect(sql).toMatch(/attendance/i);
    expect(sql).toMatch(/status_overrides/i);
    expect(sql).toMatch(/live_attendances/i);
    expect(sql).toMatch(/archived_at/i);
    expect(sql).toMatch(/live_effective_status_at/i);
    expect(sql).toMatch(/scheduled/i);
    expect(sql).toMatch(/correlation_id/i);
    expect(sql).toMatch(/actor_app_user_id/i);
    expect(sql).toContain("scheduleRevision");
    expect(sql).toContain("current_user = pg_catalog.pg_get_userbyid");
    expect(sql).toContain(
      "'public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure",
    );
    expect(sql).toMatch(/old\.ever_published_at is not null/i);
    expect(sql).toMatch(/create index attendance_verification_attempts_event_idx[\s\S]+live_event_id/i);
    expect(sql).toMatch(/LIVE schedule is unchanged/i);
    expect(sql).toMatch(/revoke execute on function public\.save_admin_live_draft[\s\S]+from service_role/i);
    expect(sql).toMatch(/create or replace function public\.generate_admin_live_attendance_code[\s\S]+ever_published_at[\s\S]+requires audited reschedule/i);
    for (const field of [
      "reservation_opens_at", "reservation_closes_at", "starts_at", "ends_at",
      "attendance_valid_from", "attendance_valid_until", "schedule_revision",
    ]) expect(sql).toContain(`new.${field} is distinct from old.${field}`);
    expect(sql).toMatch(/for update[\s\S]+clock_timestamp\(\)/i);
    expect(sql).toMatch(/before\s+update\s+or\s+delete[\s\S]+live_schedule_revisions/i);
    expect(sql).toMatch(/revoke all on function[\s\S]+reschedule_admin_live[\s\S]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function[\s\S]+reschedule_admin_live[\s\S]+to service_role/i);
    expect(sql).not.toMatch(/delete\s+from\s+(?:public\.)?live_reservations/i);
    expect(sql).not.toMatch(/update\s+(?:public\.)?live_reservations/i);
  });
});
