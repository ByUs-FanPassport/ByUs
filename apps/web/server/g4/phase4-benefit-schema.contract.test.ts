import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "../../supabase/migrations/20260903020000_phase4_benefit_economy_schema.sql",
  "utf8",
).toLowerCase();

const tables = [
  "live_benefit_campaigns",
  "live_benefit_campaign_items",
  "benefit_ticket_entries",
  "benefit_draws",
  "benefit_draw_secrets",
  "benefit_draw_candidates",
  "benefit_draw_winners",
  "benefit_fulfillments",
  "benefit_fulfillment_events",
  "benefit_recipient_private",
  "benefit_recipient_access_audits",
] as const;

describe("Phase 4 Benefit economy schema", () => {
  it("separates every campaign, draw, fulfillment, and privacy responsibility", () => {
    for (const table of tables) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("uses restrictive foreign keys and immutable operational history", () => {
    expect(sql).not.toMatch(/references public\.[^(\s]+(?:\s*\([^)]*\))?\s+on delete (?:cascade|set null)/);
    for (const table of [
      "benefit_ticket_entries",
      "benefit_draws",
      "benefit_draw_candidates",
      "benefit_draw_winners",
      "benefit_fulfillment_events",
      "benefit_recipient_access_audits",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("t || '_reject_update_delete'");
    expect(sql).toContain("t || '_reject_truncate'");
  });

  it("has no campaign-wide fan cap and only an optional positive Benefit cap", () => {
    const campaign = sql.slice(
      sql.indexOf("create table public.live_benefit_campaigns"),
      sql.indexOf("create table public.live_benefit_campaign_items"),
    );
    expect(campaign).not.toContain("per_fan_ticket_limit");
    expect(sql).toContain("per_fan_ticket_limit integer");
    expect(sql).toContain("per_fan_ticket_limit is null or per_fan_ticket_limit > 0");
    expect(sql).toContain("unique (campaign_id, benefit_id)");
  });

  it("allows the same fan to win different Benefits but not twice in one Benefit", () => {
    expect(sql).toContain("unique (draw_id, benefit_id, app_user_id)");
    expect(sql).not.toContain("unique (draw_id, app_user_id)");
    expect(sql).not.toContain("unique (campaign_id, app_user_id)");
  });

  it("keeps recipient PII out of public and Admin campaign list projections", () => {
    const publicFunctions = sql.match(/create (?:or replace )?function public\.(?:get_public|get_admin_benefit_campaign)[\s\S]*?\$\$;/g) ?? [];
    expect(publicFunctions.length).toBeGreaterThan(0);
    expect(publicFunctions.join("\n")).not.toContain("benefit_recipient_private");
    expect(publicFunctions.join("\n")).not.toMatch(/address1|address2|postal_code|phone/);
  });
});
