import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "../../supabase/migrations/20260903010000_cross_phase_event_instrumentation.sql"), "utf8");

describe("product event database contract", () => {
  it("creates a private append-only v1 measurement table", () => {
    expect(migration).toContain("create table public.fan_product_events");
    expect(migration).toContain("unique (schema_version, idempotency_key)");
    expect(migration).toContain("force row level security");
    expect(migration).toMatch(/before update or delete[\s\S]*fan_product_events/);
    expect(migration).toMatch(/before truncate[\s\S]*fan_product_events/);
    expect(migration).toContain("revoke all on table public.fan_product_events from public,anon,authenticated,service_role");
  });

  it("allows only v1 names and bounded primitive properties", () => {
    for (const name of ["creator_page_view", "ticket_credited", "ticket_debited", "fulfillment_completed"]) {
      expect(migration).toContain(`'${name}'`);
    }
    expect(migration).toContain("jsonb_typeof(p_properties) <> 'object'");
    expect(migration).toContain("jsonb_object_length(p_properties) > 20");
    expect(migration).toContain("pg_column_size(p_properties) > 2048");
    expect(migration).toContain("jsonb_typeof(property_value) not in ('string','number','boolean','null')");
  });

  it("implements exact replay and conflicting replay denial", () => {
    expect(migration).toContain("PRODUCT_EVENT_IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("'replayed', false");
    expect(migration).toContain("grant execute on function public.record_product_event_v1");
  });
});
