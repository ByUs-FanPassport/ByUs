import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_EVENT_NAMES } from "../../features/analytics/domain/product-event";

const root = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const releaseMigrations = [
  "20260902010000_phase1_reward_policy.sql", "20260902011000_phase1_tier_cutover.sql",
  "20260902012000_phase1_ticket_ledger.sql", "20260902013000_phase1_live_reward_settings.sql",
  "20260902014000_phase1_survey_reward_binding.sql", "20260902015000_activate_reward_policy_v2.sql",
  "20260902020000_phase2_reaction_domain.sql", "20260902021000_phase2_reaction_passport_attachment.sql",
  "20260902022000_phase2_verification_reward_cooldown.sql", "20260902023000_phase2_reservation_ticket.sql",
  "20260902024000_phase2_attendance_code_reward.sql", "20260902025000_phase2_mission_generalization.sql",
  "20260902026000_phase2_first_reaction_read.sql", "20260903010000_cross_phase_event_instrumentation.sql",
  "20260903010500_phase2_attribution_and_read_close.sql", "20260903015000_phase2_mission_option_display_mode.sql",
  "20260903016600_phase3_live_provider_calendar.sql", "20260903016700_phase3_live_calendar.sql",
  "20260903016800_phase3_live_schedule_revisions.sql", "20260903016900_phase3_live_journey.sql",
  "20260903016910_phase3_journey_admin_read_volatility_fix.sql", "20260903017000_phase3_collectible_claim.sql",
  "20260903020000_phase4_benefit_economy_schema.sql", "20260903020500_phase4_benefit_entry_rpc.sql",
  "20260903021000_phase4_weighted_benefit_draw.sql", "20260903022000_phase4_benefit_fulfillment_privacy.sql",
  "20260903022500_phase4_recipient_purge.sql", "20260903023000_phase4_my_reward_read.sql",
  "20260903030000_phase5_notification_channels.sql", "20260903030050_phase5_kakao_connection_state.sql",
  "20260903030100_phase5_external_delivery_plan.sql", "20260903030150_phase5_live_notification_kinds.sql",
  "20260903030200_phase5_live_reminder_revision.sql", "20260903030250_phase5_action_required_notification_kinds.sql",
  "20260903030300_phase5_action_required_notifications.sql", "20260903031000_phase5_my_fan_activity.sql",
  "20260903031100_phase5_notification_delivery_monitor.sql", "20260903031200_phase5_notification_monitor_volatility_fix.sql",
  "20260903040000_phase6_platform_analytics.sql", "20260903040100_phase6_platform_aggregates.sql",
  "20260903041000_phase6_live_analytics.sql", "20260903041100_phase6_live_attribution_fix.sql",
  "20260903041200_phase6_product_event_projections.sql", "20260903041300_phase6_recipient_purge_monitor.sql",
] as const;

describe("full PPT release inventory", () => {
  it("keeps the exact forward-only migration inventory available in order", () => {
    const names = releaseMigrations.map((name) => {
      expect(existsSync(resolve(root, "supabase/migrations", name)), name).toBe(true);
      return name.slice(0, 14);
    });
    expect(names).toEqual([...names].sort());
  });

  it("keeps every global invariant and required evidence field in the ledger", () => {
    const invariants = read("docs/plans/2026-09-03-global-invariant-ledger.md");
    const ledger = read("docs/plans/2026-09-03-verification-ledger.md");
    for (const id of ["TIER-01", "REACTION-02", "ATTR-01", "JOURNEY-03", "COLLECT-02", "BEN-DRAW-03", "PII-03", "NOTIFY-05", "ANALYTICS-02", "EVENT-02", "EVIDENCE-01", "PROD-KNOWN-01"]) {
      expect(invariants, id).toContain(`\`${id}\``);
    }
    for (const field of ["environment", "command_or_locator", "observed", "verified_at", "last_verified_commit"]) {
      expect(ledger).toContain(field);
    }
    expect(ledger).toMatch(/`PROD-KNOWN-01`[^\n]*`OUT_OF_SCOPE`/);
  });

  it("binds all product events, guarded reads, routes and deployment integrity proof", () => {
    const sql = releaseMigrations.map((name) => read(`supabase/migrations/${name}`)).join("\n");
    const routeInventory = [
      "apps/web/app/api/events/route.ts",
      "apps/web/app/api/admin/analytics/platform/route.ts",
      "apps/web/app/api/admin/analytics/live-events/[id]/route.ts",
      "apps/web/app/api/admin/maintenance/recipient-purge/route.ts",
      "apps/web/app/api/admin/notification-deliveries/route.ts",
      "apps/web/app/api/admin/blockchain-jobs/route.ts",
    ];
    for (const eventName of PRODUCT_EVENT_NAMES) expect(sql + read("apps/web/features/analytics/domain/product-event.ts")).toContain(eventName);
    for (const rpc of ["read_admin_platform_analytics", "read_admin_live_analytics", "read_admin_recipient_purge_status"]) expect(sql).toContain(rpc);
    for (const route of routeInventory) expect(existsSync(resolve(root, route)), route).toBe(true);
    expect(existsSync(resolve(root, "apps/web/e2e/operations/ppt-full-release.spec.ts"))).toBe(true);
    expect(existsSync(resolve(root, "apps/web/server/g6/deployment-fingerprint-route.test.ts"))).toBe(true);
  });
});
