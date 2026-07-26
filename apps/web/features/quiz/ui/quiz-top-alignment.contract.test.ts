import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const entryCss = readFileSync(
  resolve(process.cwd(), "features/quiz/ui/quiz-entry-screen.module.css"),
  "utf8",
);
const questionsCss = readFileSync(
  resolve(process.cwd(), "features/quiz/ui/quiz-questions-screen.module.css"),
  "utf8",
);

describe("quiz ready-content top alignment contract", () => {
  it.each([
    ["entry", entryCss],
    ["questions", questionsCss],
  ])(
    "keeps %s states centered by default and top-aligns ready content responsively",
    (_name, css) => {
      expect(css).toMatch(
        /\.shell\s*\{[^}]*place-items:center;[^}]*\}/,
      );
      expect(css).toMatch(
        /\.shellTopAligned\s*\{[^}]*align-content:start;[^}]*align-items:start;[^}]*padding-top:32px;[^}]*\}/,
      );
      expect(css).toMatch(
        /@media\s*\(min-width:48rem\)\s*\{[\s\S]*?\.shellTopAligned\s*\{\s*padding-top:64px;\s*\}/,
      );
    },
  );
});
