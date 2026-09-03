import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260903015500_phase2_mission_submission_order.sql"),
  "utf8",
);

describe("Phase 2 Mission submission ordering", () => {
  it("persists answers while the response is draft, then seals it as submitted", () => {
    const draftInsert = sql.indexOf("'draft',null,false");
    const answerInsert = sql.indexOf("insert into public.live_survey_answers");
    const submittedUpdate = sql.indexOf("status='submitted',submitted_at=now()");

    expect(draftInsert).toBeGreaterThan(-1);
    expect(answerInsert).toBeGreaterThan(draftInsert);
    expect(submittedUpdate).toBeGreaterThan(answerInsert);
  });

  it("keeps the response and answer immutability triggers enabled", () => {
    expect(sql).not.toContain("disable trigger live_survey_responses_protect_submitted");
    expect(sql).not.toContain("disable trigger live_survey_answers_protect_submitted");
  });
});
