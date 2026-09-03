import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260903016700_phase3_live_calendar.sql"),
  "utf8",
);

function definition(name: string): string {
  const start = sql.indexOf(`create function public.${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

describe("Phase 3 LIVE calendar database contract", () => {
  const calendar = definition("get_live_calendar_month(");

  it("uses a partial published schedule index and a half-open time range", () => {
    expect(sql).toMatch(/create index live_events_calendar_schedule_idx\s+on public\.live_events\s*\(starts_at, id\)/i);
    expect(sql).toMatch(/where publication_status = 'published'\s+and archived_at is null/i);
    expect(calendar).toContain("live.starts_at >= p_starts_at");
    expect(calendar).toContain("live.starts_at < p_ends_at");
  });

  it("excludes draft and archived rows while retaining all effective public statuses", () => {
    expect(calendar).toContain("live.publication_status = 'published'");
    expect(calendar).toContain("live.archived_at is null");
    expect(calendar).toMatch(/live_status_overrides/i);
    expect(calendar).toMatch(/scheduled/);
    expect(calendar).toMatch(/cancelled/);
    expect(calendar).not.toMatch(/effective_status\s*(?:<>|!=|not in)/i);
  });

  it("returns only owner-relative reservation state, never reservation identifiers or timestamps", () => {
    expect(calendar).toMatch(/p_app_user_id is null[\s\S]*then null/i);
    expect(calendar).toMatch(/'reserved'[\s\S]*'not_reserved'/i);
    expect(calendar).not.toMatch(/reservation[_ ]?id|reserved_at|passport_id|wallet/i);
  });

  it("keeps Benefit unknown until the canonical Phase 4 relationship exists", () => {
    expect(calendar).toMatch(/null[^\n]*hasBenefit|hasBenefit[^\n]*null/i);
    expect(calendar).not.toMatch(/live_benefit_campaigns|benefit_campaign_items|celebrity_id\s*=.*benefit/i);
  });

  it("is a service-role-only SECURITY DEFINER read boundary", () => {
    expect(calendar).toContain("security definer");
    expect(calendar).toContain("set search_path = ''");
    expect(sql).toMatch(/revoke all on function public\.get_live_calendar_month\([\s\S]*?\) from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.get_live_calendar_month\([\s\S]*?\) to service_role/i);
  });
});
