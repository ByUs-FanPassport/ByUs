import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/admin/mission-builder.tsx"), "utf8");

describe("Admin Mission Builder original specification controls", () => {
  it("provides visibility window controls", () => {
    expect(source).toContain('type="datetime-local"');
    expect(source).toContain("visibleFrom");
    expect(source).toContain("visibleUntil");
  });

  it("renders Mission participation and correctness statistics", () => {
    expect(source).toContain("Total participants");
    expect(source).toContain("Correct / Incorrect");
    expect(source).toContain("optionCount");
  });
});
