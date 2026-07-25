import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260726022000_live_activity_completion_growth.sql",
  ),
  "utf8",
);

function definition(name: string): string {
  const create = sql.indexOf(`create function public.${name}`);
  const replace = sql.indexOf(`create or replace function public.${name}`);
  const start = create >= 0 ? create : replace;
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("G3 authoritative fan activity completion contract", () => {
  const completion = definition("build_fan_activity_completion(");

  it("projects one owner-scoped immutable activity snapshot from authoritative records", () => {
    expect(completion).toContain("where activity.id = p_activity_id");
    expect(completion).toContain("activity.app_user_id = p_app_user_id");
    expect(completion).toContain("join public.fan_score_ledger score");
    expect(completion).toContain("join public.stamps stamp");
    for (const field of [
      "passportId",
      "earnedStamp",
      "scoreDelta",
      "updatedScore",
      "updatedLevel",
      "leveledUp",
    ]) {
      expect(completion).toContain(`'${field}'`);
    }
  });

  it("bounds cumulative score at the activity ledger row so a replay cannot drift", () => {
    expect(completion).toContain("history.created_at < score.created_at");
    expect(completion).toContain("history.created_at = score.created_at");
    expect(completion).toContain("history.id <= score.id");
  });

  it("uses only the confirmed level thresholds and previous authoritative score", () => {
    for (const threshold of [35, 20, 10, 5]) {
      expect(completion).toContain(`updated_score >= ${threshold}`);
      expect(completion).toContain(`updated_score - completion.score_delta >= ${threshold}`);
    }
    for (const level of ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]) {
      expect(completion).toContain(`'${level}'`);
    }
  });

  it.each([
    "build_owned_live_reservation_result(",
    "build_owned_live_attendance_result(",
    "build_owned_live_survey_submission_result(",
    "get_owned_live_survey(",
  ])("embeds completion in %s", (name) => {
    const projection = definition(name);
    expect(projection).toContain("'completion'");
    expect(projection).toMatch(
      /public\.build_(?:fan_activity_completion|owned_live_survey_submission_result)\(/,
    );
  });

  it("keeps the internal helper unavailable as a public RPC", () => {
    expect(sql).toContain(
      "revoke all on function public.build_fan_activity_completion(uuid, uuid)",
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.build_fan_activity_completion/i,
    );
  });
});
