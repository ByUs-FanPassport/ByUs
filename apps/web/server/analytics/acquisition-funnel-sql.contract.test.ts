import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../scripts/report-seo-conversion-funnel.sql"),
  "utf8",
);

describe("read-only acquisition funnel SQL", () => {
  it("uses bounded dates, ordered server completion evidence, and aggregate-only output", () => {
    expect(sql).toContain("begin transaction read only");
    expect(sql).toContain("'from'::timestamptz");
    expect(sql).toContain("'to'::timestamptz");
    expect(sql).toContain("interval '366 days'");
    expect(sql).toContain("event.source = 'server.commit_projection'");
    expect(sql).toMatch(/passport_issued[\s\S]*reservation_completed[\s\S]*attendance_completed[\s\S]*benefit_entered/);
    expect(sql).toContain("count(distinct anonymous_session_hash)");
    expect(sql).toContain("rollback;");
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(sql).not.toMatch(/insert\s+into|update\s+public\.|delete\s+from|create\s+(?:or\s+replace\s+)?function|grant\s|revoke\s/i);
  });
});
