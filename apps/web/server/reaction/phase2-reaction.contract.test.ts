import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260902020000_phase2_reaction_domain.sql"), "utf8");

describe("Phase 2 Reaction database contract", () => {
  it("owns one immutable reaction and one reaction job per fan and creator", () => {
    expect(sql).toContain("unique(app_user_id,celebrity_id)");
    expect(sql).toContain("entity_type in ('passport', 'stamp', 'reaction')");
    expect(sql).toContain("'byus:reaction:v1:'||p_reaction_id::text");
    expect(sql).toContain("if found then return jsonb_build_object");
    expect(sql).toContain("fan reaction is append-only");
  });

  it("requires a wallet but never requires a Passport or posts a Reward", () => {
    const rpc = sql.slice(sql.indexOf("create function public.react_to_creator"));
    expect(rpc).toContain("from public.user_wallets");
    expect(rpc).not.toContain("insert into public.fan_passports");
    expect(rpc).not.toContain("fan_score_ledger");
    expect(rpc).not.toContain("post_fan_ticket_entry");
  });
});
