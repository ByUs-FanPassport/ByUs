import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20260908030000_fan_certification_manual.sql"),"utf8");
describe("manual certification database contract",()=>{
  it("uses an owner-bound private proof model and service-role RPC boundary",()=>{expect(sql).toContain("'certification-proofs','certification-proofs',false");expect(sql).toContain("force row level security");expect(sql).toMatch(/revoke all on table[\s\S]*service_role/);expect(sql).toMatch(/grant execute[\s\S]*to service_role/);});
  it("extends score provenance with a dedicated approved submission source",()=>{expect(sql).toContain("add column manual_submission_id uuid unique");expect(sql).toContain("num_nonnulls(activity_id,adjustment_id,manual_submission_id)=1");expect(sql).toContain("and status='approved'");expect(sql).toContain("zero-point certification cannot create a score row");});
  it("freezes rewards and makes submit/review replay-safe",()=>{expect(sql).toContain("reward_revision_id uuid not null");expect(sql).toContain("certification_review_operations");expect(sql).toContain("CERTIFICATION_REVIEW_IDEMPOTENCY_CONFLICT");expect(sql).toContain("certification_one_open_or_approved_per_owner_mission");expect(sql).toContain("CERTIFICATION_PASSPORT_REQUIRED");});
  it("requires draft update identity and revision as one concurrency pair",()=>{expect(sql).toContain("(p_mission_id is null)<>(p_expected_revision is null)");expect(sql).toContain("CERTIFICATION_MISSION_REVISION_PAIR_REQUIRED");});
  it("does not expose missions from hidden LIVE parents or hidden mission revisions",()=>{expect(sql).toContain("l.publication_status='published' and l.archived_at is null");expect(sql).toContain("m.lifecycle_status in ('published','closed') and m.archived_at is null");});
  it("strictly validates the manual ticket source while preserving existing sources",()=>{expect(sql).toContain("if new.source_type<>'manual_certification' then return new; end if;");expect(sql).toContain("manual certification ticket does not match approved reward snapshot");expect(sql).toContain("post_fan_ticket_entry(submission.app_user_id");});
});
