import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721044500_g3_live_reservation_domain.sql",
  ),
  "utf8",
);

describe("G3 live and reservation domain migration contract", () => {
  it("separates CMS publication from the live content lifecycle", () => {
    expect(sql).toContain(
      "create type public.live_content_status as enum ('scheduled', 'live', 'ended', 'cancelled')",
    );
    expect(sql).toContain(
      "publication_status public.content_status not null default 'draft'",
    );
    expect(sql).toContain(
      "content_status public.live_content_status not null default 'scheduled'",
    );
    expect(sql).not.toMatch(/create type public\.live_publication_status/i);
  });

  it("keeps one canonical celebrity and brand per globally-addressable event", () => {
    expect(sql).toContain("slug text not null unique");
    expect(sql).toContain("live_events_slug_canonical");
    expect(sql).toContain(
      "celebrity_id uuid not null references public.celebrities(id) on delete restrict",
    );
    expect(sql).toContain(
      "brand_id uuid not null references public.brands(id) on delete restrict",
    );
    expect(sql).toContain("unique (id, celebrity_id)");
  });

  it("stores an ordered schedule without choosing endpoint inclusion semantics", () => {
    expect(sql).toContain("starts_at timestamptz not null");
    expect(sql).toContain("ends_at timestamptz not null");
    expect(sql).toContain("reservation_opens_at timestamptz not null");
    expect(sql).toContain("reservation_closes_at timestamptz not null");
    expect(sql).toContain("reservation_opens_at < reservation_closes_at");
    expect(sql).toContain("reservation_closes_at <= starts_at");
    expect(sql).toContain("starts_at < ends_at");
    expect(sql).not.toMatch(/(?:now\(\)|current_timestamp)\s*(?:between|<=|>=)/i);
  });

  it("accepts only safe YouTube destinations and approved hero assets", () => {
    expect(sql).toContain("youtube_url text not null");
    expect(sql).toContain("live_events_youtube_url_allowlist");
    expect(sql).toContain("youtube_url !~ '[@[:space:]]'");
    expect(sql).toContain("(?:www\\.)?youtube\\.com/(?:watch\\?|live/|embed/)");
    expect(sql).toContain("youtu\\.be/");
    expect(sql).toContain("approved_hero_url text not null");
    expect(sql).toContain("live_events_approved_hero_url_safe");
  });

  it("keeps the fan code hash private and never stores a plaintext code", () => {
    expect(sql).toContain("fan_code_hash text not null");
    expect(sql).toContain("live_events_fan_code_hash_complete");
    expect(sql).not.toMatch(/\bfan_code\s+text/i);
  });

  it("requires complete ko and en localizations and published parents before publication", () => {
    expect(sql).toContain("primary key (live_event_id, locale)");
    expect(sql).toMatch(
      /select count\(\*\)\s+from public\.live_event_localizations\s+where live_event_id = target_id\s+\) <> 2/,
    );
    expect(sql).toContain("enum_range(null::public.content_locale)");
    expect(sql).toContain("published live event requires complete ko and en localizations");
    expect(sql).toContain("published live event requires a published celebrity");
    expect(sql).toContain("published live event requires a published brand");
    expect(sql).toContain("deferrable initially deferred");
  });

  it("revalidates published live events when either parent is unpublished", () => {
    expect(sql).toContain("validate_live_events_for_celebrity_trigger");
    expect(sql).toContain("validate_live_events_for_brand_trigger");
    expect(sql).toContain("after update of status on public.celebrities");
    expect(sql).toContain("after update of status on public.brands");
  });

  it("models status overrides as append-only effective intervals without a transition matrix", () => {
    expect(sql).toContain("create table public.live_status_overrides");
    expect(sql).toContain("effective_status public.live_content_status not null");
    expect(sql).toContain("effective_from timestamptz not null");
    expect(sql).toContain("effective_until timestamptz");
    expect(sql).toContain("reason text not null");
    expect(sql).toContain("actor_admin_allowlist_id uuid not null");
    expect(sql).toContain("effective_until is null or effective_from < effective_until");
    expect(sql).toContain(
      "grant select, insert on public.live_status_overrides to service_role",
    );
    expect(sql).not.toMatch(
      /grant[^;]*(?:update|delete)[^;]*on public\.live_status_overrides/i,
    );
    expect(sql).not.toMatch(/allowed_transition|status_transition/i);
  });

  it("makes reservations append-only, idempotent, and owner-consistent", () => {
    expect(sql).toContain("create table public.live_reservations");
    expect(sql).toContain("idempotency_key uuid not null unique");
    expect(sql).toContain("unique (app_user_id, live_event_id)");
    expect(sql).toContain("live_reservations_live_celebrity_fk");
    expect(sql).toContain("live_reservations_passport_owner_fk");
    expect(sql).toContain(
      "references public.fan_passports (id, app_user_id, celebrity_id) on delete restrict",
    );
    expect(sql).toContain(
      "grant select, insert on public.live_reservations to service_role",
    );
    expect(sql).not.toMatch(/\b(?:cancelled_at|cancelled_by|cancellation_reason)\b/i);
  });

  it.each([
    "live_events",
    "live_event_localizations",
    "live_status_overrides",
    "live_reservations",
  ])("keeps private table %s inaccessible to browsers", (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(
      `revoke all on public.${table} from public, anon, authenticated`,
    );
  });

  it("grants only the minimum service-role mutations for append-only records", () => {
    expect(sql).toContain(
      "grant select, insert, update, delete on public.live_events to service_role",
    );
    expect(sql).toContain(
      "grant select, insert, update, delete on public.live_event_localizations to service_role",
    );
    expect(sql).not.toMatch(/create\s+(?:or\s+replace\s+)?view/i);
    expect(sql).not.toMatch(/grant\s+select[^;]+to\s+(?:anon|authenticated)/i);
  });
});
