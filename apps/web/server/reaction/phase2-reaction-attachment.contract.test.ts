import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260902021000_phase2_reaction_passport_attachment.sql"),"utf8");

describe("Reaction to Passport attachment",()=>{
  it("attaches once in the Passport transaction without creating a second job",()=>{
    const trigger=sql.slice(sql.indexOf("create function public.attach_reaction_to_new_passport"),sql.indexOf("create trigger fan_passports_attach_first_reaction"));
    expect(trigger).toContain("'first_reaction','fan_reaction',reaction.id");
    expect(trigger).toContain("on conflict(reaction_id) do nothing");
    expect(trigger).not.toContain("insert into public.blockchain_jobs");
  });
  it("marks the derived Stamp as Reaction chain evidence rather than a job owner",()=>{
    expect(sql).toContain("blockchain_source_type text not null default 'reaction'");
    expect(sql).toContain("blockchain_source_id uuid not null");
    expect(sql).not.toContain("first_reaction_stamps (\n  blockchain_job_id");
  });
});
