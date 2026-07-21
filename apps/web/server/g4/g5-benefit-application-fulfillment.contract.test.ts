import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  "../../supabase/migrations/20260721092000_g5_benefit_application_catalog.sql",
  "utf8",
);
describe("benefit application fulfillment contract", () => {
  it("locks and rejects hidden or archived parent content", () => {
    expect(sql).toContain("for key share");
    expect(sql).toContain("v_celebrity.status<>'published'");
    expect(sql).toContain("v_celebrity.archived_at is not null");
    expect(sql).toContain("application celebrity unavailable");
  });
  it("binds selected delivery to the exact owner, benefit, application, and claim", () => {
    expect(sql).toContain("claim.benefit_application_id=application.id");
    expect(sql).toContain("claim.benefit_id=application.benefit_id");
    expect(sql).toContain("claim.app_user_id=application.app_user_id");
    expect(sql).toContain("application.app_user_id=p_app_user_id");
  });
  it("keeps fulfillment service-only and out of catalog", () => {
    expect(sql).toContain(
      "revoke all on function public.get_owned_benefit_application(uuid,uuid) from public,anon,authenticated",
    );
    const catalog = sql.slice(
      0,
      sql.indexOf("create function public.enforce_visible_benefit_application"),
    );
    expect(catalog).not.toContain("deliveryValue");
  });
});
