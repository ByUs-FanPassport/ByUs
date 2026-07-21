import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260721033000_g2_quiz_intro.sql"),
  "utf8",
);

describe("G2 public quiz intro RPC", () => {
  it("returns only fixed public copy and constants for a published celebrity", () => {
    expect(sql).toContain("create function public.get_published_quiz_intro(");
    expect(sql).toContain("stable");
    expect(sql).toContain("c.status = 'published'");
    expect(sql).toContain("quiz.status = 'published'");
    expect(sql).toContain("question.active");
    expect(sql).toContain("option.active");
    expect(sql).toContain("option.is_correct");
    expect(sql).toContain("coalesce(bank.valid_question_count, 0) >= 3");
    expect(sql).toContain("'totalQuestions', 3");
    expect(sql).toContain("'passThreshold', 2");
    expect(sql).not.toMatch(/'(?:questions|options|isCorrect|is_correct|quizId|celebrityId)'/i);
  });

  it("is callable only by the service role through an empty search path", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function public.get_published_quiz_intro(text, public.content_locale) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.get_published_quiz_intro(text, public.content_locale) to service_role",
    );
  });
});
