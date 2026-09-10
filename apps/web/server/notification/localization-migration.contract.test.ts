import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260910120000_localization_contracts.sql"), "utf8");

describe("localization migration compatibility", () => {
  it("adds versioned locale reads without removing legacy signatures", () => {
    expect(sql).toContain("claim_localized_notification_deliveries");
    expect(sql).toContain("read_celebrity_fanpage(p_slug text,p_locale public.content_locale)");
    expect(sql).toContain("get_owned_benefit_rewards(p_app_user_id uuid,p_locale public.content_locale)");
    expect(sql).not.toMatch(/drop function public\.(claim_notification_deliveries|read_celebrity_fanpage|get_owned_benefit_rewards)/);
  });

  it("does not change stored notification links or admin certification schemas", () => {
    expect(sql).not.toContain("/my/rewards/");
    expect(sql).not.toMatch(/update public\.fan_notifications[\s\S]*deep_link/);
    expect(sql).not.toMatch(/alter table public\.certification_missions/);
    expect(sql).not.toContain("save_admin_certification_mission");
  });

  it("uses one category mapper and one external payload builder for both channels", () => {
    expect(sql).toContain("public.localized_certification_category(m.category,p_locale)");
    expect(sql).toContain("else 'Fan activity'");
    expect(sql).toContain("public.build_external_notification_payload(claimed.notification_id,claimed.locale)");
  });
});
