import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const root = resolve(process.cwd(), "../..");
const script = readFileSync(
  resolve(root, "scripts/deploy-aws-notification-worker.sh"),
  "utf8",
);
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
describe("notification AWS deployment contract", () => {
  it("packages only the notification bundle with its own function and handler", () => {
    expect(script).toContain("dist-lambda/notification-index.cjs");
    expect(script).toContain(
      'function_name="byus-notification-worker-${environment}"',
    );
    expect(script).not.toContain("byus-mint-worker");
  });
  it("creates a one-minute EventBridge target with exact invocation input and permission", () => {
    expect(script).toContain("rate(1 minute)");
    expect(script).toContain("byus.notification-cron");
    expect(script).toContain("events.amazonaws.com");
    expect(script).toContain("aws events put-targets");
    expect(vercel).not.toHaveProperty("crons");
  });
  it("is fail closed for account, region, enablement and secret existence", () => {
    expect(script).toContain("AWS account mismatch");
    expect(script).toContain("AWS region must be ap-northeast-2");
    expect(script).toContain('[[ "$enabled" == "true" ]]');
    expect(script).toContain("secretsmanager describe-secret");
    expect(script).toContain('rule_state="DISABLED"');
  });
  it("bounds CreateFunction retries to the known IAM propagation error", () => {
    expect(script).toContain("aws iam wait role-exists");
    expect(script).toContain("create_notification_lambda()");
    expect(script).toContain("max_attempts=12");
    expect(script).toContain("retry_delay_seconds=5");
    expect(script).toContain(
      "role defined for the function cannot be assumed by Lambda",
    );
    expect(script).toContain(
      "Lambda role propagation did not converge after ${max_attempts} attempts",
    );
    expect(script).toMatch(
      /if ! grep -Fq [^\n]+cannot be assumed by Lambda[^\n]+; then[\s\S]+?return 1/,
    );
    expect(script).not.toMatch(/while\s+true/);
  });
  it("rejects a prod dry-run using the implicit dev profile before build or AWS access", () => {
    const result = spawnSync(
      resolve(root, "scripts/deploy-aws-notification-worker.sh"),
      ["prod", "false", "--dry-run"],
      {
        encoding: "utf8",
        env: { ...process.env, AWS_PROFILE: "", EXPECTED_AWS_ACCOUNT_ID: "" },
      },
    );
    expect(result.status).toBe(78);
    expect(result.stderr).toContain(
      "requires explicit AWS_PROFILE=coredot-prod",
    );
  });
  it("accepts local prod dry-run validation with the explicit approved isolated identity", () => {
    const result = spawnSync(
      resolve(root, "scripts/deploy-aws-notification-worker.sh"),
      ["prod", "false", "--dry-run"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          AWS_PROFILE: "coredot-prod",
          EXPECTED_AWS_ACCOUNT_ID: "999999999999",
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "environment=prod enabled=false profile=coredot-prod account=999999999999",
    );
  });
  it("rejects the dev account even through the approved prod profile", () => {
    const result = spawnSync(
      resolve(root, "scripts/deploy-aws-notification-worker.sh"),
      ["prod", "false", "--dry-run"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          AWS_PROFILE: "coredot-prod",
          EXPECTED_AWS_ACCOUNT_ID: "200151116034",
        },
      },
    );
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("prod account must be isolated");
  });
  it("limits dev IAM to the committed dev account and secret", () => {
    const policy = JSON.parse(
      readFileSync(
        resolve(
          root,
          "infrastructure/aws/worker/dev-notification-secrets-policy.json",
        ),
        "utf8",
      ),
    );
    expect(policy.Statement[0].Resource).toBe(
      "arn:aws:secretsmanager:ap-northeast-2:200151116034:secret:byus/notification/dev-*",
    );
  });
  it("renders prod IAM from the explicitly verified account instead of the dev account", () => {
    const policy = JSON.parse(
      readFileSync(
        resolve(
          root,
          "infrastructure/aws/worker/prod-notification-secrets-policy.json",
        ),
        "utf8",
      ),
    );
    expect(policy.Statement[0].Resource).toContain(
      ":__EXPECTED_AWS_ACCOUNT_ID__:secret:byus/notification/prod-*",
    );
    expect(script).toContain(
      'replaceAll("__EXPECTED_AWS_ACCOUNT_ID__",process.env.EXPECTED_ACCOUNT)',
    );
  });
});
