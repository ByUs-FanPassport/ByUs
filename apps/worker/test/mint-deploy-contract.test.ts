import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const path = resolve(root, "scripts/deploy-aws-worker.sh");
const script = readFileSync(path, "utf8");

describe("mint AWS deployment contract", () => {
  it("always builds and packages only a fresh temporary index bundle", () => {
    expect(script).toContain("npm run build:lambda --workspace @byus/worker");
    expect(script).toContain('package_dir="$(mktemp -d)"');
    expect(script).toContain('cp "$bundle" "${package_dir}/index.cjs"');
    expect(script).toContain("zipinfo -1");
    expect(script).not.toContain('package_file="${repo_root}/apps/worker/lambda-package.zip"');
    expect(script).not.toMatch(/\s\+\s+--[a-z]/);
  });

  it("publishes current commit/timestamp and proves exact AWS code identity", () => {
    expect(script).toContain("BUILD_COMMIT");
    expect(script).toContain("BUILD_TIMESTAMP");
    expect(script).toContain("local_fresh_zip_sha256_hex");
    expect(script).toContain("local_fresh_zip_code_sha256");
    expect(script).toContain("CodeSha256");
    expect(script).toContain("known_stale_code_sha256");
    expect(script).toContain('[[ "$remote_code_sha256" != "$local_fresh_zip_code_sha256" ]]');
  });

  it("rejects incomplete Production authorization before building or AWS mutation", () => {
    const result = spawnSync(path, ["prod", "false", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, AWS_PROFILE: "", EXPECTED_AWS_ACCOUNT_ID: "", BYUS_MINT_PROD_DEPLOY_CONFIRM: "" },
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("prod deployment requires an explicit AWS_PROFILE");
    expect(script.indexOf("BYUS_MINT_PROD_DEPLOY_CONFIRM")).toBeLessThan(script.indexOf("npm run build:lambda"));
  });

  it("produces a mutation-free Dev dry-run with provenance", () => {
    const result = spawnSync(path, ["dev", "false", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, PATH: process.env.PATH },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("environment=dev");
    expect(result.stdout).toContain("account=200151116034");
    expect(result.stdout).toContain("handler=index.handler");
    expect(result.stdout).toMatch(/build_commit=[0-9a-f]{40}/);
    expect(result.stdout).toMatch(/local_fresh_zip_code_sha256=[A-Za-z0-9+/]+=*/);
    expect(result.stdout).toContain("zip_entries=index.cjs");
    expect(result.stdout).toContain("mutation=none");
  }, 30_000);
});
