import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const enumSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722114000_notification_unlock_kinds.sql",
  ),
  "utf8",
);
const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722114500_score_benefit_unlock_events.sql",
  ),
  "utf8",
);
const foundationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721120000_g7_notification_foundation.sql",
  ),
  "utf8",
);
const correctiveSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722120000_fix_benefit_unlock_projector_ambiguity.sql",
  ),
  "utf8",
);

function fn(name: string) {
  const start = sql.indexOf(`create function public.${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`missing ${name}`);
  return sql.slice(start, end + 4);
}

describe("SCORE-006 / BEN-013 database and outbox contract", () => {
  it("projects all score producers centrally in the ledger transaction", () => {
    expect(sql).toContain("after insert on public.fan_score_ledger");
    const project = fn("project_score_unlock_events()");
    expect(project).toContain(
      "v_previous_score := v_current_score - new.points",
    );
    expect(project).toContain(
      "v_previous_score < level.threshold and v_current_score >= level.threshold",
    );
    expect(project).toContain(
      "perform public.project_benefit_unlock_events(new.id)",
    );
    expect(fn("project_benefit_unlock_events(")).toContain(
      "'locked','eligible'",
    );
  });

  it("deduplicates source events and versions each real eligibility transition", () => {
    expect(enumSql).toContain("add value if not exists 'level_up'");
    expect(enumSql).toContain("add value if not exists 'benefit_unlocked'");
    expect(sql).toContain("unique (app_user_id, celebrity_id, current_level)");
    expect(sql).toContain("unique (source_ledger_id, benefit_id)");
    expect(sql).toContain(
      "unique (app_user_id, benefit_id, benefit_policy_version)",
    );
    expect(sql).toContain(
      "fan_notifications_event_once unique(kind,source_event_id)",
    );
    expect(sql).toContain(
      "on conflict (notification_id,subscription_id) do nothing",
    );
    expect(sql).toContain("fan progress events are append-only");
  });

  it("keeps durable center records separate from retryable push delivery", () => {
    expect(sql).toContain("alter table public.fan_notifications");
    expect(foundationSql).toContain(
      "create table public.notification_delivery_outbox",
    );
    expect(sql.toLowerCase()).toContain("push failure never removes this row");
    expect(sql).not.toMatch(/delete from public\.fan_notifications/i);
  });

  it("uses the shared per-subscription delivery API without creating a parallel consumer", () => {
    expect(sql).toContain("from public.push_subscriptions subscription");
    expect(sql).toContain("subscription.disabled_at is null");
    expect(sql).toContain("preference.benefit_notifications");
    expect(foundationSql).toContain(
      "create function public.claim_notification_deliveries(",
    );
    expect(foundationSql).toContain("for update skip locked");
    expect(sql).not.toContain(
      "create function public.claim_notification_delivery_outbox(",
    );
  });

  it("re-evaluates stamp-gated eligibility after Knowledge, Reservation, Attendance, and Survey stamps exist", () => {
    expect(sql).toContain("after insert on public.stamps");
    const stampProjector = fn("project_stamp_benefit_unlock_events()");
    expect(stampProjector).toContain("ledger.activity_id=new.activity_id");
    expect(stampProjector).toContain(
      "perform public.project_benefit_unlock_events(ledger_id)",
    );
    const benefitProjector = fn("project_benefit_unlock_events(");
    expect(benefitProjector).toContain(
      "stamp.stamp_type=benefit.required_stamp_type",
    );
    expect(benefitProjector).toContain(
      "prior_stamp.activity_id is distinct from source_ledger.activity_id",
    );
    for (const [stampType, file] of [
      [
        "knowledge",
        "../../supabase/migrations/20260721043000_g2_submit_generated_id_variable_fix.sql",
      ],
      [
        "reservation",
        "../../supabase/migrations/20260721060000_g3_atomic_live_reservation.sql",
      ],
      [
        "attendance",
        "../../supabase/migrations/20260721073000_g3_attendance_fan_code.sql",
      ],
      [
        "survey",
        "../../supabase/migrations/20260721074500_g3_survey_domain.sql",
      ],
    ] as const) {
      const producer = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(producer).toContain(`'${stampType}'`);
      expect(
        producer.indexOf("insert into public.fan_score_ledger"),
      ).toBeLessThan(producer.lastIndexOf("insert into public.stamps"));
    }
  });

  it("denies direct access to immutable event ledgers and retains foundation worker RPCs", () => {
    for (const table of [
      "fan_level_events",
      "benefit_eligibility_changes",
      "fan_notifications",
      "notification_delivery_outbox",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} force row level security`,
      );
    }
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(foundationSql).toContain(
      "public.claim_notification_deliveries(text,integer,integer)",
    );
    expect(foundationSql).toContain("to service_role");
  });

  it("keeps fresh and upgraded databases on an unambiguous projector body", () => {
    expect(correctiveSql).toContain(
      "create or replace function public.project_benefit_unlock_events",
    );
    for (const body of [fn("project_benefit_unlock_events("), correctiveSql]) {
      expect(body).toContain("created_notification_id uuid");
      expect(body).toContain(
        "select created_notification_id,subscription.id",
      );
      expect(body).not.toMatch(/\bnotification_id\s*:=/);
      expect(body).not.toContain("select notification_id,subscription.id");
    }
  });
});
