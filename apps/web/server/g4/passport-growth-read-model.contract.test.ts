import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260726021000_passport_growth_read_model.sql"), "utf8");

describe("Passport growth owner read model migration", () => {
  it("replaces only the owner-scoped Passport and Stamp detail projections", () => {
    expect(sql).toContain("create or replace function public.get_owned_passport_detail(");
    expect(sql).toContain("create or replace function public.get_owned_stamp_detail(");
    expect(sql).not.toContain("create or replace function public.get_owned_passport_collection(");
  });

  it("projects the optional owner nickname without identity or wallet data", () => {
    expect(sql).toContain("left join public.user_profiles profile");
    expect(sql).toContain("'owner', jsonb_build_object('nickname', profile.nickname)");
    expect(sql).not.toMatch(/verified_email|privy_user_id|user_wallets|wallet|recipient/i);
  });

  it("projects canonical source IDs and localized LIVE context", () => {
    expect(sql).toContain("'sourceType', activity.source_type");
    expect(sql).toContain("'sourceId', activity.source_id");
    for (const source of ["live_reservation", "live_attendance", "live_survey_response"]) {
      expect(sql).toContain(`activity.source_type = '${source}'`);
    }
    expect(sql).toContain("'linkable', live.publication_status = 'published' and live.archived_at is null");
    expect(sql).toContain("live_l10n.locale = p_locale");
    expect(sql).toContain("with activity_context as materialized");
    expect(sql.match(/'linkable', live\.publication_status/g)).toHaveLength(2);
    for (const table of ["live_reservations", "live_attendances", "live_survey_responses"]) {
      expect(sql.match(new RegExp(`public\\.${table}`, "g"))).toHaveLength(2);
    }
  });

  it("projects the closest owner benefit inside the same Passport statement", () => {
    expect(sql).toContain("'nextBenefit', next_benefit.value");
    expect(sql).toContain("left join lateral (");
    expect(sql).toContain("from public.benefits benefit");
    expect(sql).toContain("benefit.publication_status = 'published'");
    expect(sql).toContain("benefit.archived_at is null");
    expect(sql).toContain("owned_claim.app_user_id = passport.app_user_id");
    expect(sql).toContain("application.app_user_id = passport.app_user_id");
    expect(sql).toContain("'missingConditions', candidate.missing_conditions");
    expect(sql).toContain("jsonb_array_length(candidate.missing_conditions)");
  });

  it("retains deterministic ordering and owner scoping", () => {
    expect(sql).toContain("order by stamp.issued_at desc, stamp.id desc");
    expect(sql).toContain("order by activity.occurred_at desc, activity.id desc");
    expect(sql).toContain("passport.app_user_id = p_app_user_id");
    expect(sql).toContain("stamp.app_user_id = p_app_user_id");
  });

  it("keeps both functions service-role only", () => {
    for (const signature of [
      "public.get_owned_passport_detail(uuid, uuid, public.content_locale)",
      "public.get_owned_stamp_detail(uuid, uuid, public.content_locale)",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature}\n  from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature}\n  to service_role`);
    }
  });
});
