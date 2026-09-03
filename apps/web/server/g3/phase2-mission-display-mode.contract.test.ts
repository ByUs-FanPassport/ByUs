import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260903015000_phase2_mission_option_display_mode.sql"), "utf8");

describe("Phase 2 Mission option presentation", () => {
  it("stores and validates text, media, and text+media modes", () => {
    expect(sql).toContain("add column display_mode text");
    expect(sql).toContain("display_mode in ('text','media','text_media')");
    expect(sql).toContain("display_mode='text' and media_type is null");
    expect(sql).toContain("display_mode in ('media','text_media') and media_type is not null");
    expect(sql).toContain("disable trigger live_survey_options_protect_snapshot");
    expect(sql).toContain("enable trigger live_survey_options_protect_snapshot");
  });

  it("projects and persists the approved display mode", () => {
    expect(sql).toContain("'displayMode',o.display_mode");
    expect(sql).toContain("option_item->>'displayMode'");
  });
});
