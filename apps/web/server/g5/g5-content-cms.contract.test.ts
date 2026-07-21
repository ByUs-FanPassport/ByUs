import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721083000_g5_celebrity_quiz_cms.sql",
  ),
  "utf8",
);
describe("G5 Celebrity and Quiz CMS migration", () => {
  it("gates reads and mutations through active roles", () => {
    expect(sql).toContain("a.id = p_actor and a.active");
    expect(sql).toContain("a.role in ('admin','operator')");
    expect(sql).toContain("not p_mutation");
  });
  it("records actor, correlation, and before/after audit evidence", () => {
    expect(sql).toContain(
      "actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id",
    );
    expect(sql).toContain(
      "jsonb_build_object('before',before_row,'after',result)",
    );
  });
  it("preserves published banks and requires exact four-option questions", () => {
    expect(sql).toContain(
      "published quiz versions are immutable; create a new version",
    );
    expect(sql).toContain("jsonb_array_length(question->'options') <> 4");
    expect(sql).toContain(
      "active questions require exactly four options and one correct answer",
    );
  });
  it("keeps publication history irreversible and gates celebrity publication on a complete quiz", () => {
    expect(sql).toContain("add column ever_published_at timestamptz");
    expect(sql).toContain("ever_published_at is not null");
    expect(sql).toContain(
      "celebrity publication requires exactly one published quiz",
    );
    expect(sql).toContain(
      "celebrity publication requires a complete published quiz",
    );
  });
  it("exposes commands only to service role", () => {
    expect(sql).toMatch(
      /revoke all on function[\s\S]+from public,anon,authenticated/,
    );
    expect(sql).toMatch(/grant execute on function[\s\S]+to service_role/);
  });
});
