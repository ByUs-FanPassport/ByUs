import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721096500_g6_release_gate_lint_corrections.sql",
  ),
  "utf8",
);

describe("G6 linked database lint corrections", () => {
  it("removes only guarded wrapper attendance materialization", () => {
    expect(sql).toContain("pg_get_functiondef");
    expect(sql).toContain("does not match the expected release baseline");
    expect(sql).toContain("perform 1");
    expect(sql).toContain("for update of attendance");
    expect(sql).toContain("execute corrected");
  });

  it("retains SELECT INTO STRICT stamp targets required by core mutations", () => {
    expect(sql).toContain(
      "both variables are intentional SELECT INTO STRICT",
    );
    expect(sql).not.toContain(
      "'public.reserve_owned_live_event(uuid,uuid,uuid,uuid,text,text)'::regprocedure",
    );
    expect(sql).not.toContain(
      "'public.attend_owned_live_event(uuid,text,uuid,text,uuid,text,text)'::regprocedure",
    );
  });

  it("returns explicitly typed live lifecycle states", () => {
    for (const state of ["cancelled", "scheduled", "live", "ended"]) {
      expect(sql).toContain(
        `return '${state}'::public.live_content_status`,
      );
    }
  });

  it("assigns volatility to the function that owns the stable read behavior", () => {
    expect(sql).toContain(
      "alter function public.admin_assert_active_survey_actor(uuid,uuid,boolean) stable",
    );
    expect(sql).toContain(
      "alter function public.redact_audit_summary(jsonb) stable",
    );
    expect(sql).not.toContain(
      "alter function public.get_admin_live_survey(uuid,uuid,uuid) volatile",
    );
  });
});
