import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260902012000_phase1_ticket_ledger.sql",
  ),
  "utf8",
).toLowerCase();

describe("Phase 1 Ticket ledger database contract", () => {
  it("stores creator-scoped signed entries with one semantic source and policy snapshot", () => {
    expect(sql).toContain("create table public.fan_ticket_ledger");
    expect(sql).toContain("amount bigint not null");
    expect(sql).toContain("amount <> 0");
    expect(sql).toContain("entry_kind text not null");
    expect(sql).toContain("policy_version integer not null references public.reward_policy_versions");
    expect(sql).toContain("setting_revision bigint");
    expect(sql).toContain("reward_setting_revision_id uuid");
    expect(sql).toContain("fan_ticket_setting_identity_complete");
    expect(sql).toContain("owner_sequence bigint not null");
    expect(sql).toContain("unique (app_user_id, celebrity_id, source_type, source_id)");
    expect(sql).toContain("idempotency_key uuid not null unique");
  });

  it("posts only through a replay-safe RPC with key-before-balance lock order", () => {
    expect(sql).toContain("create function public.post_fan_ticket_entry(");
    const keyLock = sql.indexOf("phase1:ticket:key:");
    const balanceLock = sql.indexOf("phase1:ticket:balance:");
    expect(keyLock).toBeGreaterThan(-1);
    expect(balanceLock).toBeGreaterThan(keyLock);
    expect(sql).toContain("phase1_ticket_idempotency_conflict");
    expect(sql).toContain("phase1_ticket_source_conflict");
    expect(sql).toContain("phase1_ticket_negative_balance");
    expect(sql).not.toContain("sum(ledger.amount::bigint)");
    expect(sql).toContain("order by ledger.owner_sequence desc");
    expect(sql).toContain("include (resulting_balance)");
    expect(sql).toContain("existing.setting_revision is distinct from p_setting_revision");
    expect(sql).toContain("existing.reward_setting_revision_id is distinct from p_reward_setting_revision_id");
  });

  it("rejects mutation and exposes no direct write privilege", () => {
    expect(sql).toContain("before update or delete on public.fan_ticket_ledger");
    expect(sql).toContain("before truncate on public.fan_ticket_ledger");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke all on table public.fan_ticket_ledger");
    expect(sql).toContain("revoke all on function public.post_fan_ticket_entry");
    expect(sql).toContain("grant execute on function public.post_fan_ticket_entry");
    expect(sql).not.toContain("grant insert on table public.fan_ticket_ledger");
  });

  it("serializes each fan and Creator independently before deriving bigint balance", () => {
    expect(sql).toContain("p_app_user_id::text || ':' || p_celebrity_id::text");
    expect(sql).toContain("where ledger.app_user_id = p_app_user_id");
    expect(sql).toContain("and ledger.celebrity_id = p_celebrity_id");
    expect(sql).toContain("returns bigint");
  });
});
