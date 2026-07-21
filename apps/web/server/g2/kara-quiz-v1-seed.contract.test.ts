import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260721051000_kara_quiz_v1_seed.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("KARA quiz v1 production seed contract", () => {
  it("uses stable identities and refuses to replace conflicting KARA content", () => {
    expect(sql).toContain("4b415241-0000-4000-8000-000000000001");
    expect(sql).toContain("4b415241-0000-4000-8000-000000000002");
    expect(sql).toContain("KARA_SEED_CELEBRITY_CONFLICT");
    expect(sql).toContain("KARA_SEED_PUBLISHED_QUIZ_CONFLICT");
    expect(sql).toContain("KARA_SEED_CONTENT_MISMATCH");
    expect(sql).not.toMatch(/on conflict[\s\S]*do update/i);
  });

  it("documents the primary official sources used to verify all six facts", () => {
    for (const source of [
      "https://rbwjapan.jp/artist/kara.php",
      "https://www.universal-music.co.jp/kara/biography/",
      "https://www.universal-music.co.jp/kara/products/umck-5286/",
      "https://www.universal-music.co.jp/kara/products/uice-9021/",
      "https://www.universal-music.co.jp/kara/news/2022-12-06-2/",
      "https://www.universal-music.co.jp/kara/products/umck-9670/",
    ]) {
      expect(sql).toContain(`-- ${source}`);
    }
  });

  it("seeds exactly six active bilingual questions with four source-ordered options", () => {
    expect(sql).toContain("KARA는 몇 년에 데뷔했을까요?");
    expect(sql).toContain("What year did KARA debut?");
    expect(sql).toContain("KARA의 일본 데뷔 싱글은 무엇일까요?");
    expect(sql).toContain("Which song was KARA’s Japanese debut single?");
    expect(sql).toContain("KARA의 첫 일본어 정규 앨범 제목은 무엇일까요?");
    expect(sql).toContain("What is the title of KARA’s first full-length Japanese-language album?");
    expect(sql).toContain("KARA가 데뷔 15주년을 기념해 발표한 앨범은 무엇일까요?");
    expect(sql).toContain("앨범 《MOVE AGAIN》의 타이틀곡은 무엇일까요?");
    expect(sql).toContain("다음 중 KARA의 세 번째 한국 정규 앨범은 무엇일까요?");
    expect(sql).toContain("question_count <> 6");
    expect(sql).toContain("option_count <> 24");
    expect(sql).toContain("correct_count <> 6");
    expect(sql).toContain("option_position_count <> 4");
  });

  it("locks the administrator-authored correct position for every question", () => {
    expect(sql).toContain("correct_positions <> array[3, 1, 1, 1, 1, 1]::smallint[]");
    expect(sql).toContain("order by question.position");
    expect(sql.match(/1::smallint/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sql).not.toMatch(/random\s*\(/i);
  });

  it("publishes only after the complete graph exists and forces deferred validation", () => {
    const insertOptions = sql.indexOf("insert into public.celebrity_quiz_options");
    const publishQuiz = sql.indexOf("update public.celebrity_quizzes");
    const validate = sql.indexOf("set constraints all immediate", publishQuiz);
    expect(insertOptions).toBeGreaterThan(-1);
    expect(publishQuiz).toBeGreaterThan(insertOptions);
    expect(validate).toBeGreaterThan(publishQuiz);
  });
});
