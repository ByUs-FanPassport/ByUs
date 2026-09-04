import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const cleanReplay = readFileSync(resolve(root, "scripts/verify-clean-migration-chain.sh"), "utf8");
const runtimeProbe = readFileSync(
  resolve(root, "scripts/verify-phase5-notification-email-conflict.sh"),
  "utf8",
);

describe("duplicate notification-email runtime regression", () => {
  it("runs automatically in every clean migration replay", () => {
    expect(cleanReplay).toContain('bash "$ROOT_DIR/scripts/verify-phase5-notification-email-conflict.sh"');
  });

  it("executes sequential ownership, concurrent calls, and runtime privilege denial", () => {
    expect(runtimeProbe).toMatch(/later duplicate-email login transferred channel ownership/i);
    expect(runtimeProbe).toMatch(/later duplicate-email login changed the original raw destination/i);
    expect(runtimeProbe).toMatch(/race-a\.out[\s\S]*&[\s\S]*race-b\.out[\s\S]*&/i);
    expect(runtimeProbe).toMatch(/same-fingerprint race produced a non-canonical channel count/i);
    expect(runtimeProbe).toMatch(/expect_role_denied anon[\s\S]*expect_role_denied authenticated/i);
  });
});
