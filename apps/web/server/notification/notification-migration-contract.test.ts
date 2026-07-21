import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_g7_notification_foundation.sql",
  ),
  "utf8",
);
const registrationFix = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722121000_fix_push_subscription_registration.sql",
  ),
  "utf8",
);
describe("notification scheduler migration", () => {
  it("enforces one notification per owner/source and one delivery per subscription", () => {
    expect(sql).toContain("unique (app_user_id, source_key)");
    expect(
      sql.match(/on conflict \(app_user_id,source_key\) do nothing/g)?.length,
    ).toBe(2);
    expect(sql).toContain("unique (notification_id, subscription_id)");
  });
  it("schedules the two exact reservation offsets before start", () => {
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("p_now < live.starts_at");
  });
  it("excludes submitted survey respondents", () => {
    expect(sql).toContain("response.status='submitted'");
    expect(sql).toContain("not exists");
  });
  it("keeps subscription secrets and outbox service-role only", () => {
    expect(sql).toContain("revoke all on public.push_subscriptions");
    expect(sql).toContain(
      "grant select,insert,update on public.push_subscriptions to service_role",
    );
    expect(sql).toContain("notification_delivery_outbox");
  });
  it("uses lease-checked claim complete retry RPCs with bounded attempts", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("attempt_count < 8");
    expect(sql).toContain("complete_notification_delivery");
    expect(sql).toContain("retry_notification_delivery");
    expect(sql).toContain("lease_expires_at>now()");
  });
  it("does not infer benefit eligibility from a claim window", () => {
    expect(sql).not.toContain("'benefit:'||benefit.id::text||':available'");
    expect(sql).toContain("authoritative eligibility");
  });
  it("globally owns an endpoint through an atomic non-projecting RPC", () => {
    expect(sql).toContain("unique (endpoint_hash)");
    expect(sql).not.toContain("unique (app_user_id, endpoint_hash)");
    expect(sql).toContain("create function public.register_push_subscription");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("SUBSCRIPTION_OWNER_CHANGED");
    expect(sql).toContain("push subscription transfer is busy");
  });
  it("revalidates preferences survey submission and effective LIVE override at claim", () => {
    expect(sql).toContain(
      "create function public.notification_delivery_is_eligible",
    );
    expect(sql).toContain("preference.live_reminders");
    expect(sql).toContain("preference.survey_reminders");
    expect(sql).toContain("response.status='submitted'");
    expect(sql).toContain(
      "public.live_effective_status_at(notification.live_event_id,p_at)",
    );
    expect(sql).toContain("CURRENT_STATE_INELIGIBLE");
  });
  it("backfills missing per-subscription deliveries on registration and cron reruns", () => {
    expect(sql).toContain(
      "create function public.backfill_notification_deliveries",
    );
    expect(sql).toContain(
      "perform public.backfill_notification_deliveries(now(),p_app_user_id)",
    );
    expect(sql).toContain(
      "public.backfill_notification_deliveries(p_now,null)",
    );
  });
  it("qualifies subscription identifiers in fresh and upgraded registration definitions", () => {
    const fresh = sql.slice(
      sql.indexOf("create function public.register_push_subscription"),
      sql.indexOf("create function public.enqueue_due_fan_notifications"),
    );
    for (const definition of [fresh, registrationFix]) {
      expect(definition).toContain("v_subscription_id uuid");
      expect(definition).toContain("delivery.subscription_id=v_existing.id");
      expect(definition).toContain("subscription.endpoint_hash=p_endpoint_hash");
      expect(definition).not.toMatch(/\bwhere\s+subscription_id\s*=/i);
      expect(definition).not.toContain("declare existing");
    }
  });
});
