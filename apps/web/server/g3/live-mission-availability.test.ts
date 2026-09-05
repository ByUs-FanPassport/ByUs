import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { readPublishedMissionAvailability } from "./live-event-repository";

const now = new Date("2026-09-06T00:00:00Z");
const visible = { live_event_id: "event", publication_status: "published", legacy_contract: false, "live_survey_localizations.locale": "ko", visible_from: now.toISOString(), visible_until: "2026-09-07T00:00:00.000Z" };
function database(rows: Record<string, unknown>[], error: unknown = null) {
  let selected = rows;
  const query = {
    select: vi.fn((_fields: string, options: unknown) => { expect(options).toEqual({ count: "exact", head: true }); return query; }),
    eq: (key: string, value: unknown) => { selected = selected.filter(row => row[key] === value); return query; },
    lte: (key: string, value: string) => { selected = selected.filter(row => String(row[key]) <= value); return query; },
    gt: (key: string, value: string) => { selected = selected.filter(row => String(row[key]) > value); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ count: selected.length, error })),
  };
  return { from: vi.fn((table: string) => { expect(table).toBe("live_surveys"); return query; }) } as unknown as Pick<SupabaseClient, "from">;
}
describe("public mission availability", () => {
  it("includes the exact opening boundary", async () => {
    expect(await readPublishedMissionAvailability(database([visible]), "event", "ko", now)).toBe(true);
  });
  it.each([
    { publication_status: "draft" }, { legacy_contract: true },
    { "live_survey_localizations.locale": "en" }, { live_event_id: "other" },
    { visible_from: "2026-09-06T00:00:00.001Z" }, { visible_until: now.toISOString() },
  ])("excludes unavailable mission %j", async (change) => {
    expect(await readPublishedMissionAvailability(database([{ ...visible, ...change }]), "event", "ko", now)).toBe(false);
  });
  it("returns false for an empty list and rejects database failure", async () => {
    expect(await readPublishedMissionAvailability(database([]), "event", "ko", now)).toBe(false);
    await expect(readPublishedMissionAvailability(database([], { message: "offline" }), "event", "ko", now)).rejects.toThrow("Mission availability lookup failed");
  });
});
