import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type BenefitAdminActor = { appUserId: string; allowlistId: string };
export type BenefitAdminRepository = {
  read(actor: BenefitAdminActor): Promise<Record<string, unknown>>;
  save(
    actor: BenefitAdminActor,
    correlationId: string,
    input: Record<string, unknown>,
  ): Promise<string>;
  codes(
    actor: BenefitAdminActor,
    correlationId: string,
    id: string,
    expectedRevision: number,
    codes: string[],
  ): Promise<Record<string, unknown>>;
  clearCodes(
    actor: BenefitAdminActor,
    correlationId: string,
    id: string,
    expectedRevision: number,
  ): Promise<Record<string, unknown>>;
  state(
    actor: BenefitAdminActor,
    correlationId: string,
    id: string,
    expectedRevision: number,
    action: string,
    reason?: string,
  ): Promise<void>;
  decide(
    actor: BenefitAdminActor,
    correlationId: string,
    applicationId: string,
    selected: boolean,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>>;
  use(
    actor: BenefitAdminActor,
    correlationId: string,
    claimId: string,
    usedAt: string,
  ): Promise<Record<string, unknown>>;
};
type RpcClient = Pick<SupabaseClient, "rpc">;
function result(data: unknown, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  return data;
}
export function createSupabaseBenefitAdminRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): BenefitAdminRepository {
  const db =
    client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const actorArgs = (a: BenefitAdminActor) => ({
    p_actor_app_user_id: a.appUserId,
    p_actor_admin_allowlist_id: a.allowlistId,
  });
  return {
    async read(a) {
      const { data, error } = await db.rpc(
        "get_admin_benefit_manager",
        actorArgs(a),
      );
      return result(data, error) as Record<string, unknown>;
    },
    async save(a, c, i) {
      const { data, error } = await db.rpc("save_admin_benefit_draft", {
        ...actorArgs(a),
        p_correlation_id: c,
        p_benefit_id: i.id || null,
        p_expected_revision: i.expectedRevision ?? null,
        p_slug: i.slug,
        p_celebrity_id: i.celebrityId,
        p_allocation_mode: i.allocationMode,
        p_delivery_type: i.deliveryType,
        p_claim_opens_at: i.claimOpensAt,
        p_claim_closes_at: i.claimClosesAt,
        p_stock_limit: i.stockLimit ?? null,
        p_per_user_limit: i.perUserLimit,
        p_minimum_score: i.minimumScore,
        p_minimum_level: i.minimumLevel,
        p_required_stamp_type: i.requiredStampType || null,
        p_required_activity_type: i.requiredActivityType || null,
        p_title_ko: i.titleKo,
        p_summary_ko: i.summaryKo,
        p_eligibility_ko: i.eligibilityKo,
        p_delivery_ko: i.deliveryKo,
        p_title_en: i.titleEn,
        p_summary_en: i.summaryEn,
        p_eligibility_en: i.eligibilityEn,
        p_delivery_en: i.deliveryEn,
        p_delivery_secret: i.deliverySecret || null,
      });
      return String(result(data, error));
    },
    async codes(a, c, id, expectedRevision, codes) {
      const { data, error } = await db.rpc("upload_admin_benefit_codes", {
        ...actorArgs(a),
        p_correlation_id: c,
        p_benefit_id: id,
        p_expected_revision: expectedRevision,
        p_codes: codes,
      });
      return result(data, error) as Record<string, unknown>;
    },
    async clearCodes(a, c, id, expectedRevision) {
      const { data, error } = await db.rpc("clear_admin_benefit_codes", {
        ...actorArgs(a),
        p_correlation_id: c,
        p_benefit_id: id,
        p_expected_revision: expectedRevision,
      });
      return result(data, error) as Record<string, unknown>;
    },
    async state(a, c, id, expectedRevision, action, reason) {
      const { error } = await db.rpc("set_admin_benefit_state", {
        ...actorArgs(a),
        p_correlation_id: c,
        p_benefit_id: id,
        p_expected_revision: expectedRevision,
        p_action: action,
        p_reason: reason ?? null,
      });
      result(null, error);
    },
    async decide(a, c, applicationId, selected, idempotencyKey) {
      const { data, error } = await db.rpc("decide_admin_benefit_application", {
        ...actorArgs(a),
        p_correlation_id: c,
        p_application_id: applicationId,
        p_selected: selected,
        p_idempotency_key: idempotencyKey,
      });
      return result(data, error) as Record<string, unknown>;
    },
    async use(a, c, claimId, usedAt) {
      const { data, error } = await db.rpc("mark_admin_benefit_claim_used", {
        ...actorArgs(a),
        p_correlation_id: c,
        p_claim_id: claimId,
        p_used_at: usedAt,
      });
      return result(data, error) as Record<string, unknown>;
    },
  };
}
