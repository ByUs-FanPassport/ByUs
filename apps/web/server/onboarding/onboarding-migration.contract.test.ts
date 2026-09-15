import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260915100000_fan_onboarding_state.sql",
  ),
  "utf8",
);

describe("fan onboarding state migration contract", () => {
  it("keeps account state private behind service-role RPCs", () => {
    expect(sql).toMatch(
      /app_user_id uuid primary key references public\.app_users\(id\) on delete cascade/i,
    );
    expect(sql).toMatch(
      /alter table public\.fan_onboarding_states force row level security/i,
    );
    expect(sql).toMatch(
      /revoke all on public\.fan_onboarding_states from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.read_owned_onboarding_state\(uuid\) to service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.dismiss_owned_onboarding\(uuid\) to service_role/i,
    );
  });

  it("derives completed actions from canonical account-wide records", () => {
    expect(sql).toMatch(
      /from public\.user_profiles profiles[\s\S]*profiles\.app_user_id = p_app_user_id/i,
    );
    expect(sql).toMatch(
      /from public\.fan_passports passports[\s\S]*passports\.app_user_id = p_app_user_id/i,
    );
    expect(sql).toMatch(
      /from public\.live_reservations reservations[\s\S]*reservations\.app_user_id = p_app_user_id/i,
    );
    expect(sql).not.toMatch(/live_event_localizations|publication_status|content_status/);
  });

  it("makes profile completion and dismissal monotonic", () => {
    expect(sql).toMatch(
      /on conflict \(app_user_id\) do update[\s\S]*profile_completed = true/i,
    );
    expect(sql).toMatch(
      /profile_completed = public\.fan_onboarding_states\.profile_completed[\s\S]*or excluded\.profile_completed/i,
    );
    expect(sql).toMatch(/dismissed = true/i);
  });
});
