import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260911062915_raffle_fulfillment_policy.sql",
  ),
  "utf8",
);
const reminderKeySql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260911065150_raffle_recipient_reminder_key.sql",
  ),
  "utf8",
);
const pickupRequiredFieldsSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260911070000_raffle_pickup_policy_required_fields.sql",
  ),
  "utf8",
);

describe("raffle fulfillment policy SQL contract", () => {
  it("stores immutable per-item policy without granting table reads", () => {
    expect(sql).toContain("create table public.raffle_fulfillment_policies");
    expect(sql).toContain("primary key(campaign_id,benefit_id,version)");
    expect(sql).toContain("raffle_fulfillment_policies_reject_update_delete");
    expect(sql).toContain(
      "revoke all on table public.raffle_fulfillment_policies from public,anon,authenticated,service_role",
    );
    expect(sql).toMatch(
      /configure_admin_raffle_fulfillment_policy[\s\S]*item\.fulfillment_method<>v_method/,
    );
  });

  it("requires complete localized on-site pickup instructions for new policies", () => {
    expect(pickupRequiredFieldsSql).toContain(
      "add constraint raffle_fulfillment_policy_pickup_required_fields",
    );
    expect(pickupRequiredFieldsSql).toMatch(
      /method<>'on_site_pickup'[\s\S]*pickup_ends_on is not null/,
    );
    for (const field of [
      "pickup_venue_ko",
      "pickup_venue_en",
      "pickup_instructions_ko",
      "pickup_instructions_en",
    ]) {
      expect(pickupRequiredFieldsSql).toContain(`length(btrim(${field}))>0`);
    }
    expect(pickupRequiredFieldsSql).not.toContain("not valid");
    expect(pickupRequiredFieldsSql).not.toContain(
      "update public.raffle_fulfillment_policies",
    );
  });

  it("checks policy acknowledgment before the first v2 ticket debit", () => {
    const rpc = sql.slice(
      sql.indexOf("create function public.enter_owned_benefit_v2"),
      sql.indexOf("alter function public.enter_owned_benefit("),
    );
    expect(rpc.indexOf("RAFFLE_POLICY_ACK_REQUIRED")).toBeGreaterThan(-1);
    expect(rpc.indexOf("RAFFLE_POLICY_ACK_REQUIRED")).toBeLessThan(
      rpc.indexOf("public.post_fan_ticket_entry"),
    );
    expect(rpc.indexOf("idempotency_key=p_idempotency_key")).toBeLessThan(
      rpc.indexOf("RAFFLE_POLICY_ACK_REQUIRED"),
    );
    expect(rpc).toContain("for update of c");
    expect(rpc).toContain("for update;");
    expect(rpc).toContain("policy_acknowledgment_source");
  });

  it("blocks old command bypasses while preserving legacy records", () => {
    expect(sql).toMatch(
      /create function public\.enter_owned_benefit\([\s\S]*RAFFLE_POLICY_ACK_REQUIRED/,
    );
    expect(sql).toMatch(
      /create function public\.save_owned_benefit_recipient\([\s\S]*RAFFLE_RECIPIENT_V2_REQUIRED/,
    );
    expect(sql).toMatch(
      /create function public\.transition_admin_benefit_fulfillment\([\s\S]*RAFFLE_CLAIM_CLOSED/,
    );
    expect(sql).toContain("policy_acknowledgment_source text not null default 'legacy'");
    const legacyEntry = sql.slice(
      sql.indexOf("create function public.enter_owned_benefit("),
      sql.indexOf("-- Draw publication captures"),
    );
    expect(legacyEntry.indexOf("for update of c")).toBeLessThan(
      legacyEntry.indexOf("RAFFLE_POLICY_ACK_REQUIRED"),
    );
    expect(legacyEntry).toMatch(/live_benefit_campaign_items[\s\S]*for update/);
  });

  it("captures publication-relative timing and owner-only projections", () => {
    expect(sql).toContain("values('2026-09-raffle-v2',true");
    expect(sql).toMatch(
      /save_owned_benefit_recipient_v2[\s\S]*p_consent_version is distinct from '2026-09-raffle-v2'/,
    );
    expect(sql).toMatch(
      /publish_admin_benefit_draw[\s\S]*v_published_at\+interval '168 hours'/,
    );
    expect(sql).toMatch(
      /get_owned_benefit_recipient[\s\S]*winner\.app_user_id=p_app_user_id/,
    );
    expect(sql).toMatch(
      /save_owned_benefit_recipient_v2[\s\S]*RAFFLE_RECIPIENT_DEADLINE_PASSED/,
    );
    expect(sql).toContain("create function public.get_owned_raffle_result(");
    expect(sql).toContain("create function public.get_owned_raffles(");
    expect(sql).toContain("RAFFLE_LIST_CURSOR_OWNER_MISMATCH");
    expect(sql).toMatch(
      /build_owned_raffle_result[\s\S]*winner\.app_user_id=p_app_user_id[\s\S]*event\.to_status='shipping_in_transit'[\s\S]*'trackingNumber'/,
    );
  });

  it("serializes unclaimed closure, pickup completion, and recipient edits", () => {
    expect(sql).toMatch(
      /close_admin_benefit_fulfillment_unclaimed[\s\S]*for update/,
    );
    expect(sql).toContain("RAFFLE_COMPLETED_CLAIM_CANNOT_CLOSE");
    expect(sql).toMatch(
      /transition_admin_benefit_fulfillment_v2[\s\S]*name_phone_last4[\s\S]*manual_review/,
    );
    expect(sql).toMatch(
      /save_owned_benefit_recipient_v2[\s\S]*for update of f/,
    );
  });

  it("returns a minimum audited roster and invalidates stale reminders", () => {
    const roster = sql.slice(
      sql.indexOf("create function public.get_admin_benefit_pickup_roster"),
      sql.indexOf("create function public.enqueue_due_benefit_recipient_reminders"),
    );
    expect(roster).toContain("v_role='viewer'");
    expect(roster).toContain("right(regexp_replace(recipient.phone");
    expect(roster).not.toContain("'phone',recipient.phone");
    expect(roster).not.toContain("address1");
    expect(roster).toContain("benefit_pickup_roster_access_audits");
    expect(sql).toMatch(
      /enqueue_due_benefit_recipient_reminders[\s\S]*interval '24 hours'/,
    );
    expect(sql).toMatch(
      /notification_delivery_is_eligible[\s\S]*not exists\(select 1 from public\.benefit_recipient_private/,
    );
    expect(reminderKeySql).toMatch(
      /benefit_recipient_reminder_source_key[\s\S]*digest[\s\S]*sha256/,
    );
    expect(reminderKeySql).not.toMatch(/p_deadline_at::text/);
    expect(
      reminderKeySql.match(/benefit_recipient_reminder_source_key\(/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("keeps new public RPCs service-role only and inner helpers uncallable", () => {
    expect(sql).toContain(
      "grant execute on function public.get_owned_raffle_result(uuid,uuid,public.content_locale) to service_role",
    );
    expect(sql).toContain(
      "revoke all on function public.raffle_fulfillment_policy_json(uuid,uuid,text) from public,anon,authenticated,service_role",
    );
    expect(sql).not.toMatch(/grant (select|insert|update|delete) on/);
  });
});
