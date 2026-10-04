import { describe, expect, it } from "vitest";
import { parseSettingsSection, SETTINGS_SECTIONS } from "./settings-navigation";

describe("settings navigation", () => {
  it("accepts only the supported query sections", () => {
    for (const section of SETTINGS_SECTIONS) expect(parseSettingsSection(section)).toBe(section);
    expect(parseSettingsSection("unknown")).toBeNull();
    expect(parseSettingsSection(null)).toBeNull();
  });
});
