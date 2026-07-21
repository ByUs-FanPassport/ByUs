import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260721053000_g3_stamp_activity_generalization.sql",
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();

describe("G3 stamp and activity generalization migration contract", () => {
  it("allows exactly the four planned stamp types", () => {
    expect(sql).toContain("drop constraint stamps_stamp_type_check");
    expect(sql).toContain(
      "stamp_type in ('knowledge', 'reservation', 'attendance', 'survey')",
    );
  });

  it("preserves the G2 Knowledge source ownership invariant", () => {
    expect(sql).toContain("new.activity_type = 'knowledge'");
    expect(sql).toContain("new.source_type <> 'quiz_pass'");
    expect(sql).toContain("from public.quiz_passes");
    expect(sql).toContain("app_user_id = new.app_user_id");
    expect(sql).toContain("celebrity_id = new.celebrity_id");
    expect(sql).toContain("knowledge activity must reference an owned quiz pass");
  });

  it("binds Reservation activity to the owned live reservation and celebrity", () => {
    expect(sql).toContain("new.activity_type = 'reservation'");
    expect(sql).toContain("new.source_type <> 'live_reservation'");
    expect(sql).toContain("from public.live_reservations reservation");
    expect(sql).toContain("join public.live_events live");
    expect(sql).toContain("reservation.id = new.source_id");
    expect(sql).toContain("reservation.app_user_id = new.app_user_id");
    expect(sql).toContain("reservation.celebrity_id = new.celebrity_id");
    expect(sql).toContain("live.celebrity_id = new.celebrity_id");
  });

  it("requires every stamp type to exactly match its owned activity type", () => {
    expect(sql).toContain("create or replace function public.validate_stamp_activity_type()");
    expect(sql).toContain("new.stamp_type <> linked_activity_type::text");
    expect(sql).toContain("stamp type must exactly match activity type");
    expect(sql).toContain("stamp requires an owned activity for the same celebrity");
    expect(sql).toContain("create trigger stamps_validate_activity_type");
    expect(sql).toContain("create trigger stamps_validate_activity_type_update");
    expect(sql).toContain("drop function public.validate_knowledge_stamp_activity()");
  });

  it("maps each database stamp type to the worker's title-case payload", () => {
    expect(sql).toContain("create function public.assert_stamp_blockchain_job_link_v2(");
    expect(sql).toContain(
      "credential_stamp_type not in ('knowledge', 'reservation', 'attendance', 'survey')",
    );
    expect(sql).toContain(
      "upper(left(credential_stamp_type, 1)) || substr(credential_stamp_type, 2)",
    );
    expect(sql).toContain("job stamp type does not match credential");
    expect(sql).toContain("new.stamp_type, new.mint_status");
  });

  it("retains strict worker job identity, recipient, payload, and result checks", () => {
    expect(sql).toContain("job_record.entity_type <> 'stamp'");
    expect(sql).toContain("'byus:stamp:v1:' || credential_id::text");
    expect(sql).toContain(
      "array['recipient', 'celebrityslug', 'issuanceid', 'stamptype']",
    );
    expect(sql).toContain("actual_payload_keys <> expected_payload_keys");
    expect(sql).toContain("chain_id = 91342");
    expect(sql).toContain("provider = 'privy'");
    expect(sql).toContain("wallet_type = 'embedded'");
    expect(sql).toContain("job worker submission payload is invalid");
    expect(sql).toContain("credential mint status does not match queue status");
    expect(sql).toContain("job completion result does not match credential");
  });

  it("fails migration preflight instead of repairing existing inconsistent facts", () => {
    expect(sql).toContain("do $preflight$");
    expect(sql).toContain("existing knowledge activity source is invalid");
    expect(sql).toContain("existing reservation activity source is invalid");
    expect(sql).toContain("existing stamp activity type is invalid");
    expect(sql).not.toMatch(/update\s+public\.(?:fan_activities|stamps)\s+set/i);
  });
});
