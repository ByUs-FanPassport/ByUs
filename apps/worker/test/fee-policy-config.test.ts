import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");

describe("mint fee policy deployment configuration", () => {
  it("uses the reviewed defaults in the worker example and AWS secret writer", () => {
    const example = readFileSync(resolve(root, "apps/worker/.env.example"), "utf8");
    const secretWriter = readFileSync(resolve(root, "scripts/configure-aws-worker-secret.mjs"), "utf8");
    for (const entry of [
      "GIWA_MINT_MAX_GAS=1000000",
      "GIWA_MINT_MAX_FEE_PER_GAS_WEI=100000000",
      "GIWA_MINT_MAX_PRIORITY_FEE_PER_GAS_WEI=100000000",
      "GIWA_MINT_MAX_EXECUTION_FEE_WEI=100000000000000",
    ]) expect(example).toContain(entry);
    for (const key of [
      "GIWA_MINT_MAX_GAS",
      "GIWA_MINT_MAX_FEE_PER_GAS_WEI",
      "GIWA_MINT_MAX_PRIORITY_FEE_PER_GAS_WEI",
      "GIWA_MINT_MAX_EXECUTION_FEE_WEI",
    ]) expect(secretWriter).toContain(`process.env.${key}`);
  });
});
