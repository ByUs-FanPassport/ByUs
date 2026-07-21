import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721086000_g5_survey_builder_cms.sql",
  ),
  "utf8",
);
const correctionSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721090500_g5_survey_builder_option_qualification.sql",
  ),
  "utf8",
);

describe("ADM-006 survey builder database contract", () => {
  it("qualifies draft graph delete columns that collide with PL/pgSQL locals", () => {
    expect(correctionSql).toContain(
      "live_survey_option_localizations localization where localization.option_id",
    );
    expect(correctionSql).toContain(
      "live_survey_options option_row where option_row.question_id",
    );
    expect(correctionSql).toContain(
      "live_survey_question_localizations localization where localization.question_id",
    );
    expect(correctionSql).not.toContain(
      "live_survey_option_localizations where option_id in",
    );
  });
  it("checks the locked revision before publish/archive and advances every lifecycle etag", () => {
    expect(sql).toContain("for update;");
    expect(sql).toContain("if p_command in ('publish','archive')");
    expect(sql).toContain("expected_revision <> survey_record.revision");
    expect(sql).toContain("stale survey revision");
    expect(sql.match(/revision=revision\+1/g)).toHaveLength(4);
    for (const lifecycle of ["published", "closed", "archived"]) {
      expect(sql).toContain(`lifecycle_status='${lifecycle}'`);
    }
  });

  it("rejects archived parent lives and noncanonical question/option order", () => {
    expect(sql).toContain("archived_at is null for update");
    expect(sql).toContain("min(position)<>1 or max(position)<>count(*)");
    expect(sql).toContain(
      "canonical common question or option order schema is invalid",
    );
  });

  it("keeps general CMS and audit projections free of response answers", () => {
    const projection = sql.slice(
      sql.indexOf("create or replace function public.get_admin_live_survey"),
      sql.indexOf(
        "create or replace function public.assert_canonical_live_survey_schema",
      ),
    );
    expect(projection).not.toMatch(
      /live_survey_responses|live_survey_answers|free_text/,
    );
    expect(sql).toContain("Never returns response or free-text answer data");
  });
});
