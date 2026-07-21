import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.js";

const valid = {
  WORKER_ENABLED: "false", WORKER_ID: "worker-test", SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40), PINATA_JWT: "x".repeat(40),
  METADATA_ASSET_BASE_URI: "ipfs://bafyassets/v1", GIWA_RPC_URL: "https://rpc.testnet.giwa.io",
  GIWA_CHAIN_ID: "91342", GIWA_RELAYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  BYUS_PASSPORT_CONTRACT_ADDRESS: `0x${"2".repeat(40)}`,
  BYUS_STAMP_CONTRACT_ADDRESS: `0x${"3".repeat(40)}`, GIWA_DEPLOYMENT_BLOCK: "100",
};

describe("worker environment", () => {
  it("parses a complete, explicitly disabled configuration", () => {
    const env = parseEnv(valid);
    expect(env.WORKER_ENABLED).toBe(false);
    expect(env.WORKER_LEASE_SECONDS).toBe(120);
  });

  it("rejects the wrong chain", () => {
    expect(() => parseEnv({ ...valid, GIWA_CHAIN_ID: "1" })).toThrow("91342");
  });

  it("rejects a missing relayer key", () => {
    const { GIWA_RELAYER_PRIVATE_KEY: _, ...missing } = valid;
    expect(() => parseEnv(missing)).toThrow();
  });

  it("rejects mutable HTTPS metadata assets", () => {
    expect(() => parseEnv({ ...valid, METADATA_ASSET_BASE_URI: "https://assets.byus.kr/v1" })).toThrow("immutable ipfs");
  });
});
