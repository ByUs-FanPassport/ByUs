import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260721063000_g3_live_override_policy.sql",
  ),
  "utf8",
);

describe("G3 live administrator override policy migration contract", () => {
  it("derives the prior state from an active latest override or the server clock", () => {
    expect(sql).toContain("create function public.live_effective_status_at");
    expect(sql).toContain("override.effective_from <= target_at");
    expect(sql).toContain("target_at < override.effective_until");
    expect(sql).toContain("order by override.effective_from desc, override.created_at desc, override.id desc");
    expect(sql).toContain("if target_at < live_record.starts_at");
    expect(sql).toContain("elsif target_at < live_record.ends_at");
  });

  it("enforces the approved transition matrix and terminal states", () => {
    expect(sql).toContain("prior_status = 'scheduled'");
    expect(sql).toContain("('scheduled', 'live', 'cancelled')");
    expect(sql).toContain("prior_status = 'live'");
    expect(sql).toContain("('live', 'ended', 'cancelled')");
    expect(sql).toContain("prior_status in ('ended', 'cancelled')");
    expect(sql).toContain("ended and cancelled live events are terminal");
  });

  it("serializes per event and deterministically rejects overlapping half-open intervals", () => {
    expect(sql).toContain("create extension if not exists btree_gist with schema extensions");
    expect(sql).toContain("live_status_overrides_no_overlap");
    expect(sql).toContain("exclude using gist");
    expect(sql).toMatch(/from public\.live_events\s+where id = new\.live_event_id\s+for update/);
    expect(sql).toMatch(/tstzrange\(\s*existing\.effective_from/);
    expect(sql).toContain("tstzrange(new.effective_from, new.effective_until, '[)')");
    expect(sql).toContain("live status override intervals must not overlap");
    expect(sql).toContain("live status overrides must be appended chronologically");
    expect(sql).toContain("successor.effective_from > new.effective_from");
  });

  it("requires bounded delay and extension intervals and permanent terminal facts", () => {
    expect(sql).toContain("new.effective_status in ('scheduled', 'live')");
    expect(sql).toContain("scheduled and live overrides require effective_until");
    expect(sql).toContain("effective_until must be later than effective_from");
    expect(sql).toContain("new.effective_status in ('ended', 'cancelled')");
    expect(sql).toContain("terminal overrides must not expire");
    expect(sql).toContain("scheduled override expiry would create an invalid transition");
    expect(sql).toContain("live override expiry would create an invalid transition");
    expect(sql).toContain("new.effective_until < live_record.starts_at");
    expect(sql).toContain("new.effective_until < live_record.ends_at");
  });

  it("requires an active allowlisted actor and records before/after audit evidence", () => {
    expect(sql).toContain("from public.admin_allowlist allowlist");
    expect(sql).toContain("allowlist.email = lower(trim(target_verified_admin_email))");
    expect(sql).toContain("for share");
    expect(sql).not.toContain("for key share");
    expect(sql).not.toContain("target_actor_admin_allowlist_id");
    expect(sql).toContain("actor_is_active is distinct from true");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("'before', jsonb_build_object");
    expect(sql).toContain("'after', jsonb_build_object");
    expect(sql).toContain("new.actor_admin_allowlist_id");
  });

  it("makes the table immutable and exposes only the validated service RPC", () => {
    expect(sql).toContain("before update or delete on public.live_status_overrides");
    expect(sql).toContain("before truncate on public.live_status_overrides");
    expect(sql).toContain("live status overrides are append-only");
    expect(sql).toContain("revoke insert on public.live_status_overrides from service_role");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("create function public.create_live_status_override");
    expect(sql).toMatch(/grant execute on function public\.create_live_status_override\([\s\S]*?\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.create_live_status_override\([\s\S]*?\) from public, anon, authenticated/);
  });

  it("does not mutate the live event schedule or reservation workflow", () => {
    expect(sql).not.toMatch(/update public\.live_events/i);
    expect(sql).not.toMatch(/update public\.live_status_overrides/i);
    expect(sql).toContain("live lifecycle changes require an append-only override");
    expect(sql).toContain("published live schedule is immutable; use a bounded override");
    expect(sql).toContain("before insert or update on public.live_events");
    expect(sql).not.toMatch(/(?:create|replace) function public\.reserve_live_event/i);
    expect(sql).not.toMatch(/\blive_reservations\b/i);
  });
});
