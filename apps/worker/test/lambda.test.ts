import { describe, expect, it, vi } from "vitest";
import { createLambdaHandler } from "../src/lambda.js";

const validSecret = JSON.stringify({
  WORKER_ID: "byus-worker-dev-01",
  WORKER_BATCH_SIZE: "5",
  WORKER_LEASE_SECONDS: "120",
  WORKER_POLL_INTERVAL_MS: "5000",
  WORKER_RECEIPT_POLL_ATTEMPTS: "24",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40),
  PINATA_JWT: "y".repeat(40),
  PINATA_API_URL: "https://api.pinata.cloud",
  METADATA_ASSET_BASE_URI: "ipfs://bafyassets/credentials/v1",
  GIWA_RPC_URL: "https://rpc.testnet.giwa.io",
  GIWA_CHAIN_ID: "91342",
  GIWA_RELAYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  BYUS_PASSPORT_CONTRACT_ADDRESS: `0x${"2".repeat(40)}`,
  BYUS_STAMP_CONTRACT_ADDRESS: `0x${"3".repeat(40)}`,
  GIWA_DEPLOYMENT_BLOCK: "1",
});

describe("AWS Lambda worker entrypoint", () => {
  it("stays inert without loading secrets when the environment is disabled", async () => {
    const loadSecret = vi.fn();
    const runWorker = vi.fn();
    const handler = createLambdaHandler({ loadSecret, runWorker }, {
      WORKER_ENABLED: "false",
      WORKER_ENVIRONMENT: "prod",
      WORKER_SECRET_ID: "byus/worker/prod",
    });

    await expect(handler({ source: "byus.supabase-cron", environment: "prod" })).resolves.toEqual({ enabled: false, claimed: 0 });
    expect(loadSecret).not.toHaveBeenCalled();
    expect(runWorker).not.toHaveBeenCalled();
  });

  it("rejects a caller payload for the wrong source or environment", async () => {
    const handler = createLambdaHandler({ loadSecret: vi.fn(), runWorker: vi.fn() }, {
      WORKER_ENABLED: "true",
      WORKER_ENVIRONMENT: "dev",
      WORKER_SECRET_ID: "byus/worker/dev",
    });

    await expect(handler({ source: "manual", environment: "dev" })).rejects.toThrow("invocation source");
    await expect(handler({ source: "byus.supabase-cron", environment: "prod" })).rejects.toThrow("environment mismatch");
  });

  it("loads one environment secret, validates it strictly, and runs one batch", async () => {
    const loadSecret = vi.fn().mockResolvedValue(validSecret);
    const runWorker = vi.fn().mockResolvedValue(2);
    const handler = createLambdaHandler({ loadSecret, runWorker }, {
      WORKER_ENABLED: "true",
      WORKER_ENVIRONMENT: "dev",
      WORKER_SECRET_ID: "byus/worker/dev",
    });

    await expect(handler({ source: "byus.supabase-cron", environment: "dev" })).resolves.toEqual({ enabled: true, claimed: 2 });
    expect(loadSecret).toHaveBeenCalledWith("byus/worker/dev");
    expect(runWorker).toHaveBeenCalledWith(expect.objectContaining({ WORKER_ID: "byus-worker-dev-01", GIWA_CHAIN_ID: 91342 }));
  });

  it("fails closed when the secret JSON is incomplete", async () => {
    const handler = createLambdaHandler({ loadSecret: vi.fn().mockResolvedValue("{}"), runWorker: vi.fn() }, {
      WORKER_ENABLED: "true",
      WORKER_ENVIRONMENT: "dev",
      WORKER_SECRET_ID: "byus/worker/dev",
    });

    await expect(handler({ source: "byus.supabase-cron", environment: "dev" })).rejects.toThrow();
  });

  it("fails closed when Secrets Manager returns plain text instead of JSON", async () => {
    const runWorker = vi.fn();
    const handler = createLambdaHandler({
      loadSecret: vi.fn().mockResolvedValue("plain-text-secret"),
      runWorker,
    }, {
      WORKER_ENABLED: "true",
      WORKER_ENVIRONMENT: "dev",
      WORKER_SECRET_ID: "byus/worker/dev",
    });

    await expect(
      handler({ source: "byus.supabase-cron", environment: "dev" }),
    ).rejects.toThrow(SyntaxError);
    expect(runWorker).not.toHaveBeenCalled();
  });
});
