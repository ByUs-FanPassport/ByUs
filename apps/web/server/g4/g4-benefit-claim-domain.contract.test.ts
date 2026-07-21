import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260721061500_g4_benefit_claim_domain.sql"), "utf8");

describe("G4 benefit and atomic claim domain", () => {
  it("models a bilingual celebrity-scoped published catalog without seed content", () => {
    expect(sql).toContain("create table public.benefits");
    expect(sql).toContain("create table public.benefit_localizations");
    expect(sql).toContain("published benefit requires complete ko and en localizations");
    expect(sql).not.toMatch(/insert into public\.benefits/i);
  });

  it("supports all planned eligibility and availability dimensions", () => {
    for (const field of ["minimum_score", "minimum_level", "required_stamp_type", "required_activity_type", "stock_limit", "per_user_limit", "claim_opens_at", "claim_closes_at"]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("p_now >= benefit.claim_opens_at and p_now < benefit.claim_closes_at");
    expect(sql).toContain("code.claimed_by_claim_id is null");
  });

  it("keeps every delivery kind and secret inventory outside public catalog rows", () => {
    expect(sql).toContain("'text', 'external_link', 'shared_code', 'unique_code'");
    expect(sql).toContain("create table public.benefit_delivery_vault");
    expect(sql).toContain("create table public.benefit_unique_codes");
    const publicRpc = sql.slice(sql.indexOf("create function public.get_published_benefits"), sql.indexOf("create function public.claim_benefit"));
    expect(publicRpc).not.toContain("secret_value");
    expect(publicRpc).not.toContain("code_value");
  });

  it("atomically rechecks ownership, eligibility, publication, window, limits and stock", () => {
    expect(sql).toContain("where id = p_benefit_id for update");
    expect(sql).toContain("eligible fan passport is required");
    expect(sql).toContain("benefit score or level requirement is not met");
    expect(sql).toContain("required stamp is missing");
    expect(sql).toContain("required activity is missing");
    expect(sql).toContain("per-user claim limit reached");
    expect(sql).toContain("benefit stock is exhausted");
    expect(sql).toContain("p_now >= v_benefit.claim_closes_at");
  });

  it("provides exact idempotent replay and concurrency-safe one-time codes", () => {
    expect(sql).toContain("idempotency_key uuid not null unique");
    expect(sql).toContain("idempotency key belongs to a different claim");
    expect(sql).toContain("for update skip locked limit 1");
    expect(sql).toContain("claimed_by_claim_id = v_claim_id");
    expect(sql).toContain("'replayed', true");
  });

  it("makes claim audits append-only", () => {
    expect(sql).toContain("create table public.benefit_claim_audits");
    expect(sql).toContain("before update or delete on public.benefit_claim_audits");
    expect(sql).toContain("benefit claim audit is append-only");
    expect(sql).not.toMatch(/grant (?:update|delete).*benefit_claim_audits/i);
  });

  it("exposes only service-role security-definer boundaries", () => {
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("alter table public.benefit_unique_codes enable row level security");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.claim_benefit(uuid, uuid, uuid, timestamptz) to service_role");
  });
});
