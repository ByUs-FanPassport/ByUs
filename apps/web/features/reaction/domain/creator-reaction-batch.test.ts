import { describe, expect, it } from "vitest";
import { parseCompleteCreatorReactionBatch } from "./creator-reaction-batch";

describe("creator reaction batch response", () => {
  it("parses the exact requested slug map", () => {
    expect([...parseCompleteCreatorReactionBatch({ states: { kara: { reacted: true }, elina: { reacted: false } } }, ["kara", "elina"])]).toEqual([
      ["kara", true], ["elina", false],
    ]);
  });

  it.each([
    { states: { kara: { reacted: true } } },
    { states: { kara: { reacted: true }, elina: { reacted: false }, extra: { reacted: false } } },
    { states: { kara: { reacted: true, extra: true }, elina: { reacted: false } } },
    { states: { kara: { reacted: true }, elina: {} } },
    { states: { kara: { reacted: true }, elina: { reacted: false } }, extra: true },
  ])("rejects missing, extra, or malformed state instead of inferring false", (value) => {
    expect(() => parseCompleteCreatorReactionBatch(value, ["kara", "elina"])).toThrow();
  });
});
