import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Collectible worker secret guard", () => {
  it("rejects Dev Collectible binding variables on the Production path", () => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "../../scripts/configure-aws-worker-secret.mjs"), "prod"], {
      encoding: "utf8",
      env: {
        ...process.env,
        BYUS_COLLECTIBLE_CONTRACT_ADDRESS: `0x${"4".repeat(40)}`,
        GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK: "200",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Dev-only");
  });
});
