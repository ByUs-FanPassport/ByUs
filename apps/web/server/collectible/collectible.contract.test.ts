import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260903017000_phase3_collectible_claim.sql"), "utf8");

describe("Phase 3 Collectible SQL contract", () => {
  it("uses an immutable Journey-bound 48-hour default and a half-open claim window", () => {
    expect(sql).toContain("claim_window_duration_hours integer not null default 48");
    expect(sql).toMatch(/observed_at>=frozen\.opens_at|claimed_at >= frozen_ends_at/);
    expect(sql).toContain("observed_at>=until_at");
    expect(sql).toContain("observed_at<until_at");
  });

  it("requires one completion, claim, Collectible job, and embedded wallet without Ticket or Score writes", () => {
    expect(sql).toContain("unique (app_user_id, live_event_id)");
    expect(sql).toContain("unique (journey_completion_id)");
    expect(sql).toContain("'byus:collectible:v1:'||claim_id::text");
    expect(sql).toContain("w.wallet_type='embedded'");
    const claimFunction = sql.slice(sql.indexOf("create function public.claim_owned_live_collectible"));
    expect(claimFunction).not.toMatch(/insert into public\.fan_ticket_ledger|post_fan_ticket_entry|score/i);
  });

  it("freezes the first ended schedule observation and extends reconciliation explicitly", () => {
    expect(sql).toContain("on conflict (live_event_id) do nothing");
    expect(sql).toContain("public.live_effective_status_at");
    expect(sql).toContain("select 1 from public.live_collectible_claims where blockchain_job_id=old.id");
    expect(sql).toContain("new.entity_type='collectible'");
    expect(sql).toContain("array['passport','stamp','reaction']::text[]");
  });
});
