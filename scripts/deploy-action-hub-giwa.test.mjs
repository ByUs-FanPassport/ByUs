import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { keccak256, padHex } from "viem";

let deployment;
try {
  deployment = await import("./deploy-action-hub-giwa.mjs");
} catch (error) {
  assert.fail(`deployment CLI module should load: ${error.message}`);
}

const ADMIN = "0xeee82f960476c888950c798c444c1fd92cbbfe50";
const DEPLOYER = "0x6b411f5afc240680bb32df1b30be07692d5032b4";
const WRITER = "0xd0f5dd0885ca87f2c9f4d1017fa1714dd98dc815";

function config(overrides = {}) {
  return {
    chainId: 91342,
    rpcUrl: "https://example.invalid",
    environment: "production",
    deployer: DEPLOYER,
    exclusiveWriterAssertion: DEPLOYER,
    roles: {
      governanceAdmin: ADMIN,
      writer: WRITER,
      migrator: ADMIN,
      corrector: ADMIN,
      pauser: ADMIN,
    },
    existing: {
      eas: "0x4200000000000000000000000000000000000021",
      schemaRegistry: "0x4200000000000000000000000000000000000020",
      passport: "0x17f9fb7658a326dd88db523739c227faf50fca20",
      stamp: "0x1adcde3473c4e884e60205b397ece744d8892285",
    },
    collectible: "0x0000000000000000000000000000000000000000",
    environmentId: deployment.ENVIRONMENT_ID,
    guards: {
      maxGasPerTransaction: "6000000",
      maxFeePerGasWei: "2000000000",
      maxPriorityFeePerGasWei: "1000000000",
      maxTotalDeploymentFeeWei: "50000000000000000",
    },
    ...overrides,
  };
}

test("builds the fixed GIWA deployment sequence without NFT replacement or role grants", () => {
  const plan = deployment.buildDeploymentPlan(config(), {
    startNonce: 11n,
    artifacts: deployment.fixtureArtifactsForTests(),
  });

  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["register-schema", "deploy-timelock", "deploy-context-registry", "deploy-codec", "deploy-hub-implementation", "deploy-hub-proxy"],
  );
  assert.equal(plan.steps.some((step) => /passport|stamp|collectible|grant/i.test(step.id)), false);
  assert.equal(plan.timelock.delaySeconds, 172800);
  assert.deepEqual(plan.timelock.proposers, [ADMIN]);
  assert.deepEqual(plan.timelock.executors, [ADMIN]);
  assert.equal(plan.timelock.bootstrapAdmin, "0x0000000000000000000000000000000000000000");
  assert.equal(plan.initialization.admin, plan.addresses.timelock);
  assert.equal(plan.deployer, DEPLOYER);
  assert.equal(plan.timelock.proposers.includes(plan.deployer), false);
  assert.equal(plan.initialization.collectible, "0x0000000000000000000000000000000000000000");
  assert.equal(plan.followUp.unsignedNftMinterGrants.length, 2);
  assert.equal(plan.followUp.contextRegistrationTemplate.delaySeconds, 172800);
});

test("rejects a wrong chain and a writer that overlaps privileged operators", () => {
  assert.throws(
    () => deployment.validatePublicConfig(config({ chainId: 1 })),
    /chainId must be 91342/,
  );
  assert.throws(
    () => deployment.validatePublicConfig(config({ roles: { governanceAdmin: ADMIN, writer: ADMIN, migrator: ADMIN, corrector: ADMIN, pauser: ADMIN } })),
    /writer must/,
  );
  assert.throws(
    () => deployment.validatePublicConfig(config({ environmentId: `0x${"00".repeat(32)}` })),
    /environmentId must be non-zero/,
  );
  assert.throws(
    () => deployment.validatePublicConfig(config({ deployer: "0x2222222222222222222222222222222222222222" })),
    /deployer must match the approved Dev relayer/,
  );
  assert.throws(
    () => deployment.validatePublicConfig(config({ collectible: "0x1111111111111111111111111111111111111111" })),
    /collectible must remain zero/,
  );
});

test("requires a matching exclusive writer assertion for execute mode", () => {
  assert.throws(
    () => deployment.assertExecutionAuthorization(config(), WRITER),
    /exclusiveWriterAssertion must match deployer/,
  );
});

test("refuses to re-sign an uncertain journaled step", () => {
  const reconciliation = deployment.reconcileJournalStep({
    id: "deploy-codec",
    nonce: "14",
    status: "signed",
    txHash: `0x${"12".repeat(32)}`,
    signedRawTransaction: `0x02${"34".repeat(100)}`,
  }, { transaction: null, receipt: null });

  assert.deepEqual(reconciliation, {
    action: "stop-uncertain",
    reason: "signed transaction is absent from RPC; never re-sign this nonce",
  });
});

test("enforces per-transaction and total maximum fee exposure", () => {
  const guards = deployment.normalizeGuards(config().guards);
  assert.throws(
    () => deployment.assertFeeGuards([{ id: "x", gas: 6_000_001n, maxFeePerGas: 1n }], guards),
    /gas exceeds guard/,
  );
  assert.throws(
    () => deployment.assertFeeGuards([{ id: "x", gas: 6_000_000n, maxFeePerGas: 2_000_000_000n }], { ...guards, maxTotalDeploymentFeeWei: 1n }),
    /total deployment fee exposure exceeds guard/,
  );
});

test("rejects target code drift after the plan was reviewed", () => {
  const reviewed = {
    versions: { eas: "1.4.1-beta.3", schemaRegistry: "1.3.1-beta.2" },
    codes: { eas: { address: config().existing.eas, runtimeCodeHash: `0x${"11".repeat(32)}` } },
  };
  assert.throws(
    () => deployment.assertTargetSnapshot(reviewed, {
      ...reviewed,
      codes: { eas: { address: config().existing.eas, runtimeCodeHash: `0x${"22".repeat(32)}` } },
    }),
    /target code changed after plan review/,
  );
});

test("postflight rejects residual deployer governance and a wrong implementation slot", () => {
  const expectedImplementation = `0x${"12".repeat(20)}`;
  const valid = {
    timelockDelay: 172800n,
    deployerHasTimelockAdmin: false,
    governanceAdminHasTimelockAdmin: false,
    governanceAdminIsProposer: true,
    governanceAdminIsExecutor: true,
    proxyImplementation: expectedImplementation,
    hubRoles: { expectedAssignments: true, deployerHasAnyRole: false },
  };
  assert.doesNotThrow(() => deployment.assertPostflightGovernance(valid, expectedImplementation));
  assert.throws(
    () => deployment.assertPostflightGovernance({ ...valid, deployerHasTimelockAdmin: true }, expectedImplementation),
    /residual deployer governance/,
  );
  assert.throws(
    () => deployment.assertPostflightGovernance({ ...valid, proxyImplementation: deployment.ZERO_ADDRESS }, expectedImplementation),
    /implementation slot/,
  );
});

test("computes the packed Hub writer role storage slot used by on-chain readback", () => {
  assert.equal(
    deployment.hubRoleStorageSlot(
      "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
      WRITER,
    ),
    "0x701fe80d561833d95c707e582614af383dd70ed50948bdbc4e07b56b49dfd15b",
  );
});

test("executes a reviewed plan once and resumes only from journaled hashes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "byus-giwa-deploy-"));
  try {
    const normalized = deployment.validatePublicConfig({
      ...config(),
      guards: {
        ...config().guards,
        gasLimitByStep: Object.fromEntries([
          "register-schema", "deploy-timelock", "deploy-context-registry", "deploy-codec", "deploy-hub-implementation", "deploy-hub-proxy",
        ].map((id) => [id, "100000"])),
      },
    });
    const plan = deployment.buildDeploymentPlan(normalized, {
      startNonce: 11n,
      artifacts: deployment.fixtureArtifactsForTests(),
    });
    const receipts = new Map();
    let nonce = 11;
    let signed = 0;
    let storageReads = 0;
    const client = {
      getTransactionCount: async () => nonce,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
      estimateGas: async () => 50_000n,
      sendRawTransaction: async ({ serializedTransaction }) => keccak256(serializedTransaction),
      waitForTransactionReceipt: async ({ hash }) => {
        const receipt = { status: "success", transactionHash: hash, blockNumber: BigInt(100 + nonce), gasUsed: 50_000n, effectiveGasPrice: 1n, contractAddress: null };
        receipts.set(hash, receipt);
        nonce += 1;
        return receipt;
      },
      getTransactionReceipt: async ({ hash }) => {
        if (!receipts.has(hash)) throw new Error("transaction could not be found");
        return receipts.get(hash);
      },
      getBytecode: async () => "0x60006000f3",
      readContract: async ({ address, functionName, args }) => {
        if (functionName === "getMinDelay") return 172_800n;
        if (functionName === "hasRole") return args[0] !== deployment.ZERO_BYTES32;
        if (functionName === "admin") return plan.addresses.timelock;
        if (functionName === "environmentId") return normalized.environmentId;
        if (functionName === "eas") return normalized.existing.eas;
        if (functionName === "getSchema") return plan.schema.uid;
        if (functionName === "getAssetBinding") return [normalized.existing.passport, normalized.existing.stamp, normalized.collectible][args[1]];
        throw new Error(`unexpected read ${address} ${functionName}`);
      },
      getStorageAt: async ({ slot }) => {
        storageReads += 1;
        if (slot === "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc") {
          return padHex(plan.addresses.hubImplementation, { size: 32 });
        }
        return storageReads <= 7 ? padHex("0x01", { size: 32 }) : deployment.ZERO_BYTES32;
      },
    };
    const account = {
      address: DEPLOYER,
      signTransaction: async () => {
        signed += 1;
        return `0x02${signed.toString(16).padStart(2, "0")}${"34".repeat(32)}`;
      },
    };
    const paths = { journalPath: join(temp, "journal.json"), manifestPath: join(temp, "manifest.json") };
    const targetSnapshot = { schemaExists: false };
    await deployment.executePlan({ client, account, config: normalized, plan, ...paths, targetSnapshot });
    assert.equal(signed, 6);
    assert.equal(JSON.parse(await readFile(paths.journalPath, "utf8")).steps.length, 6);
    storageReads = 0;
    await deployment.executePlan({ client, account, config: normalized, plan, ...paths, targetSnapshot: { schemaExists: true } });
    assert.equal(signed, 6, "resume must not sign confirmed steps again");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
