import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260906230000_owned_creator_reactions_batch.sql"), "utf8");

describe("owned creator reaction batch SQL", () => {
  it("joins one owner reaction query to requested creator slugs", () => {
    expect(sql).toContain("get_owned_creator_reactions");
    expect(sql).toContain("from unnest(p_celebrity_slugs) with ordinality");
    expect(sql).toContain("group by input.slug");
    expect(sql).toContain("left join public.celebrities");
    expect(sql).toContain("left join public.fan_reactions");
    expect(sql).toContain("reaction.app_user_id=p_app_user_id");
  });

  it("grants only the service role", () => {
    expect(sql).toContain("revoke all on function public.get_owned_creator_reactions(uuid,text[]) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.get_owned_creator_reactions(uuid,text[]) to service_role");
    expect(sql).not.toMatch(/grant execute[^;]+\b(?:anon|authenticated)\b/);
  });
});
