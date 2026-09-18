import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "../../supabase/migrations");
const sql = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8"))
  .join("\n");

describe("attendance replay status contract", () => {
  it("classifies an existing owner/live attendance under the same advisory lock before returning it", () => {
    const definition = sql.slice(sql.indexOf("create function public.attend_owned_live_event_with_replay("));
    expect(definition).toContain("'g3:attendance:target:' || p_app_user_id::text || ':' || p_live_slug");
    expect(definition.indexOf("pg_advisory_xact_lock")).toBeLessThan(definition.indexOf("select exists"));
    expect(definition).toContain("jsonb_build_object('replayed', replayed)");
  });

  it("keeps the replay-classifying wrapper service-private", () => {
    expect(sql).toContain("revoke all on function public.attend_owned_live_event_with_replay(");
    expect(sql).toContain("grant execute on function public.attend_owned_live_event_with_replay(");
    expect(sql).toContain(") to service_role;");
  });
});
