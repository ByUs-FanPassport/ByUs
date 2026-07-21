import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const fixture = readFileSync(resolve(root, "scripts/seed-kara-nualeaf-e2e-fixture.mjs"), "utf8");
const runner = readFileSync(resolve(root, "scripts/run-kara-nualeaf-e2e.mjs"), "utf8");
const config = readFileSync(resolve(process.cwd(), "playwright.authenticated.config.ts"), "utf8");
const spec = readFileSync(resolve(process.cwd(), "e2e/operations/kara-nualeaf-live-benefit.spec.ts"), "utf8");
const ignore = readFileSync(resolve(root, ".gitignore"), "utf8");
const fingerprintRoute = readFileSync(resolve(process.cwd(), "server/g6/deployment-fingerprint-route.ts"), "utf8");

describe("KARA NUALEAF operational E2E safety contract", () => {
  it("defaults to read-only preflight and gates every mutation", () => {
    expect(fixture).toContain('process.argv[2] ?? "preflight"');
    expect(fixture).toContain("I_UNDERSTAND_LINKED_DEV_MUTATION");
    expect(fixture).toContain("E2E_SUPABASE_PROJECT_MISMATCH");
    expect(fixture).toContain("E2E_DEPLOYMENT_BINDING_MISMATCH");
    expect(fixture).toContain('APPROVED_LINKED_DEV_ORIGIN = "https://byus-dev.vercel.app"');
    expect(config).toContain('APPROVED_LINKED_DEV_ORIGIN = "https://byus-dev.vercel.app"');
    expect(runner.indexOf('"preflight"')).toBeLessThan(runner.indexOf('"seed"'));
    expect(fixture).toContain('appJson("/api/admin/e2e-deployment-fingerprint"');
    expect(fixture.indexOf("deployment fingerprint preflight")).toBeLessThan(fixture.indexOf("const dependencies = await context()"));
    expect(fixture).toContain("E2E_SERVER_PROJECT_MISMATCH");
    expect(fingerprintRoute).toContain("supabaseProjectRef(dependencies.fingerprint.supabaseUrl)");
    expect(fingerprintRoute).toContain('"cache-control": "private, no-store"');
  });

  it("cannot retain authenticated browser traces, screenshots, or video", () => {
    expect(config).toContain('trace: "off"');
    expect(config).toContain('screenshot: "off"');
    expect(config).toContain('video: "off"');
    expect(config).toContain("os.tmpdir()");
    expect(ignore).toContain("playwright-report/");
    expect(ignore).toContain("test-results/");
  });

  it("uses bounded overrides and deterministic operation keys", () => {
    expect(fixture).not.toContain("p_effective_until: null");
    expect(spec).not.toContain("idempotencyKey: crypto.randomUUID()");
    expect(spec).toContain("stableUuid(\"reservation\"");
    expect(spec).toContain("stableUuid(\"attendance\"");
    expect(spec).toContain("stableUuid(\"benefit-selection\"");
    expect(spec).toContain("claimReplay");
    expect(spec).toContain("selectedDeliveryReplay");
  });

  it("preflights fan Passport and admin manager projections", () => {
    expect(fixture).toContain("E2E_KARA_PASSPORT_MISSING");
    expect(fixture).toContain('appJson("/api/admin/lives"');
    expect(fixture).toContain('appJson("/api/admin/benefits"');
    expect(spec).toContain("managedBenefitsA.benefits");
    expect(spec).toContain('action: "decide"');
    expect(spec).toContain("selectedDelivery");
    expect(spec).toContain("ownedApplication.claim");
    expect(fixture).toContain("E2E_PARTIAL_FIXTURE_LIVE");
    expect(fixture).toContain("E2E_PARTIAL_FIXTURE_SURVEY");
    expect(fixture).toContain("E2E_PARTIAL_FIXTURE_BENEFIT");
    expect(runner).toContain('"cleanup"');
    expect(runner).toContain("throw originalFailure");
  });
});
