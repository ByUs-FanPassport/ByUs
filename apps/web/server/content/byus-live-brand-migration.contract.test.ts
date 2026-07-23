import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260724010000_byus_live_brand.sql",
  ),
  "utf8",
);

describe("ByUs LIVE brand migration contract", () => {
  it("publishes a bilingual ByUs brand with the canonical product asset", () => {
    expect(sql).toContain("'byus'");
    expect(sql).toContain("'/images/guest-home/byus-wordmark.svg'");
    expect(sql).toContain("'https://byus.kr'");
    expect(sql).toContain(
      "'팬과 셀럽의 LIVE 순간을 연결하는 ByUs 공식 브랜드입니다.'",
    );
    expect(sql).toContain(
      "'The official ByUs brand connecting fans with celebrity LIVE moments.'",
    );
  });

  it("moves only the Elina and Changha LIVE records to canonical ByUs content", () => {
    expect(sql).toContain("'elina-nualeaf-live'");
    expect(sql).toContain("'elina-byus-live'");
    expect(sql).toContain("'Elina × ByUs LIVE'");
    expect(sql).toContain(
      "'Elina와 ByUs가 함께하는 예정 LIVE를 만나보세요.'",
    );
    expect(sql).toContain("'Join the upcoming Elina × ByUs LIVE.'");
    expect(sql).toContain("'changha-nualeaf-live'");
    expect(sql).toContain("'changha-byus-live'");
    expect(sql).toContain("'Changha × ByUs LIVE'");
    expect(sql).toContain(
      "'Changha와 ByUs가 함께하는 예정 LIVE를 만나보세요.'",
    );
    expect(sql).toContain("'Join the upcoming Changha × ByUs LIVE.'");
    expect(sql).not.toContain("'kara-nualeaf-live'");
  });

  it("fails closed unless each expected Production record is updated exactly once", () => {
    expect(sql.match(/unexpected production live record/g)).toHaveLength(2);
    expect(sql.match(/unexpected production localization count/g)).toHaveLength(
      2,
    );
    expect(sql).toContain("get diagnostics affected = row_count");
  });
});
