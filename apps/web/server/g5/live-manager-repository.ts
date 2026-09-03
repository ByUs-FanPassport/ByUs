import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LiveScheduleRevision } from "../../features/live/domain/live-schedule";

export type LiveManagerActor = { appUserId: string; allowlistId: string };
export type JourneyRequirementInput = {
  liveEventId: string;
  expectedRevision: number;
  requirePassport: boolean;
  requireReservation: boolean;
  requireAttendance: boolean;
  bonusTicketAmount: number;
  missions: Array<{ missionId: string; version: number }>;
};
export type LiveManagerRepository = {
  read(actor: LiveManagerActor): Promise<Record<string, unknown>>;
  save(actor: LiveManagerActor, correlationId: string, input: Record<string, unknown>): Promise<{ id: string; fanCode?: string }>;
  generateAttendanceCode(actor: LiveManagerActor, correlationId: string, input: Record<string, unknown>): Promise<{ fanCode: string; validFrom: string; validUntil: string }>;
  publication(actor: LiveManagerActor, correlationId: string, id: string, published: boolean): Promise<void>;
  archive(actor: LiveManagerActor, correlationId: string, id: string, reason: string): Promise<void>;
  override(actor: LiveManagerActor, correlationId: string, id: string, input: Record<string, unknown>): Promise<string>;
  previewStatus(
    actor: LiveManagerActor,
    correlationId: string,
    id: string,
    action: "publish" | "unpublish" | "archive",
    reason?: string,
  ): Promise<void>;
  saveRewardSettings(actor: LiveManagerActor, correlationId: string, input: Record<string, unknown>): Promise<{ revisionId: string; revision: number }>;
  publishRewardSettings(actor: LiveManagerActor, correlationId: string, input: Record<string, unknown>): Promise<{ revisionId: string; revision: number }>;
  reschedule(actor: LiveManagerActor, correlationId: string, input: LiveScheduleRevision): Promise<{ revisionId: string; revision: number }>;
  saveJourneyRequirements(actor: LiveManagerActor, correlationId: string, input: JourneyRequirementInput): Promise<{ revisionId: string; revision: number }>;
  publishJourneyRequirements(actor: LiveManagerActor, correlationId: string, input: Pick<JourneyRequirementInput, "liveEventId" | "expectedRevision">): Promise<{ revisionId: string; revision: number }>;
};

type RpcClient = Pick<SupabaseClient, "rpc">;

function assert(data: unknown, error: { message: string } | null): unknown {
  if (error) throw new Error(error.message);
  return data;
}

export function createSupabaseLiveManagerRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): LiveManagerRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async read(actor) {
      const args = {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_live_event_id: null,
      };
      const [manager, settings, attendance, journeyRequirements] = await Promise.all([
        db.rpc("get_admin_live_manager", args),
        db.rpc("get_admin_live_reward_settings", args),
        db.rpc("get_admin_live_attendance_settings", args),
        db.rpc("get_admin_live_journey_requirements", args),
      ]);
      const managerResult = assert(manager.data, manager.error) as Record<string, unknown>;
      const attendanceRows = assert(attendance.data, attendance.error) as Array<Record<string, unknown>>;
      const attendanceByLive = new Map(attendanceRows.map((row) => [row.liveEventId, row]));
      return {
        ...managerResult,
        lives: ((managerResult.lives ?? []) as Array<Record<string, unknown>>).map((live) => ({
          ...live,
          attendanceValidFrom: attendanceByLive.get(live.id)?.validFrom ?? live.startsAt,
          attendanceValidUntil: attendanceByLive.get(live.id)?.validUntil ?? live.endsAt,
        })),
        rewardSettings: assert(settings.data, settings.error),
        journeyRequirements: assert(journeyRequirements.data, journeyRequirements.error),
      };
    },
    async save(actor, correlationId, input) {
      const { data, error } = await db.rpc("save_admin_live_draft_v3", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId, p_live_event_id: input.id ?? null, p_slug: input.slug,
        p_celebrity_id: input.celebrityId, p_brand_id: input.brandId,
        p_starts_at: input.startsAt, p_ends_at: input.endsAt,
        p_reservation_opens_at: input.reservationOpensAt, p_reservation_closes_at: input.reservationClosesAt,
        p_live_provider: input.liveProvider,
        p_external_live_url: input.externalLiveUrl,
        p_hero_url: input.heroUrl,
        p_title_ko: input.titleKo, p_summary_ko: input.summaryKo, p_hero_alt_ko: input.heroAltKo,
        p_title_en: input.titleEn, p_summary_en: input.summaryEn, p_hero_alt_en: input.heroAltEn,
      });
      return assert(data, error) as { id: string; fanCode?: string };
    },
    async generateAttendanceCode(actor, correlationId, input) {
      const { data, error } = await db.rpc("generate_admin_live_attendance_code", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: input.liveEventId,
        p_valid_from: input.validFrom,
        p_valid_until: input.validUntil,
      });
      return assert(data, error) as { fanCode: string; validFrom: string; validUntil: string };
    },
    async publication(actor, correlationId, id, published) {
      const { error } = await db.rpc("set_admin_live_publication", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId, p_live_event_id: id, p_published: published,
      });
      assert(null, error);
    },
    async archive(actor, correlationId, id, reason) {
      const { error } = await db.rpc("archive_admin_live", {
        p_actor_app_user_id: actor.appUserId, p_live_event_id: id, p_actor_admin_allowlist_id: actor.allowlistId,
        p_reason: reason, p_correlation_id: correlationId,
      });
      assert(null, error);
    },
    async override(actor, correlationId, id, input) {
      const { data, error } = await db.rpc("create_admin_live_status_override", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId, p_live_event_id: id,
        p_effective_status: input.status, p_effective_from: input.effectiveFrom,
        p_effective_until: input.effectiveUntil || null, p_reason: input.reason,
      });
      return String(assert(data, error));
    },
    async previewStatus(actor, correlationId, id, action, reason) {
      const { error } = await db.rpc("set_admin_live_preview_status", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: id,
        p_action: action,
        p_reason: reason ?? null,
      });
      assert(null, error);
    },
    async saveRewardSettings(actor, correlationId, input) {
      const { data, error } = await db.rpc("save_admin_live_reward_settings", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: input.liveEventId,
        p_expected_revision: input.expectedRevision,
        p_mission_score: input.missionScore,
        p_mission_ticket: input.missionTicket,
        p_journey_bonus_ticket: input.journeyBonusTicket,
      });
      const result = assert(data, error) as { revisionId: string; revision: number };
      return result;
    },
    async publishRewardSettings(actor, correlationId, input) {
      const { data, error } = await db.rpc("publish_admin_live_reward_settings", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: input.liveEventId,
        p_expected_revision: input.expectedRevision,
      });
      return assert(data, error) as { revisionId: string; revision: number };
    },
    async reschedule(actor, correlationId, input) {
      const { data, error } = await db.rpc("reschedule_admin_live", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: input.liveEventId,
        p_expected_revision: input.expectedRevision,
        p_reason: input.reason,
        p_reservation_opens_at: input.reservationOpensAt,
        p_reservation_closes_at: input.reservationClosesAt,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_attendance_valid_from: input.attendanceValidFrom,
        p_attendance_valid_until: input.attendanceValidUntil,
      });
      return assert(data, error) as { revisionId: string; revision: number };
    },
    async saveJourneyRequirements(actor, correlationId, input) {
      const { data, error } = await db.rpc("save_admin_live_journey_requirement", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: input.liveEventId,
        p_expected_revision: input.expectedRevision,
        p_require_passport: input.requirePassport,
        p_require_reservation: input.requireReservation,
        p_require_attendance: input.requireAttendance,
        p_bonus_ticket_amount: input.bonusTicketAmount,
        p_missions: input.missions,
      });
      return assert(data, error) as { revisionId: string; revision: number };
    },
    async publishJourneyRequirements(actor, correlationId, input) {
      const { data, error } = await db.rpc("publish_admin_live_journey_requirement", {
        p_actor_app_user_id: actor.appUserId,
        p_actor_admin_allowlist_id: actor.allowlistId,
        p_correlation_id: correlationId,
        p_live_event_id: input.liveEventId,
        p_expected_revision: input.expectedRevision,
      });
      return assert(data, error) as { revisionId: string; revision: number };
    },
  };
}
