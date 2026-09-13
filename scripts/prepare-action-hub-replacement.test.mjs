import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REPLACEMENT_ENVIRONMENT_ID,
  REPLACEMENT_ENVIRONMENT_LABEL,
  buildReplacementPlan,
  createReplacementExecutionConfig,
  loadReplacementArtifacts,
} from "./prepare-action-hub-replacement.mjs";

const manifest = JSON.parse(await readFile(new URL("./fixtures/giwa-action-hub-v1-manifest.json", import.meta.url)));
const artifacts = await loadReplacementArtifacts(new URL("..", import.meta.url));
const ADMIN = "0xeee82f960476c888950c798c444c1fd92cbbfe50";
const DEPLOYER = "0x6b411f5afc240680bb32df1b30be07692d5032b4";

test("builds exactly the new V2 registry and a proxy over the deployed implementation", () => {
  const config = createReplacementExecutionConfig(manifest);
  const plan = buildReplacementPlan(manifest, config, 33n, artifacts);

  assert.deepEqual(plan.steps.map(({ id, nonce }) => ({ id, nonce })), [
    { id: "deploy-context-registry", nonce: "33" },
    { id: "deploy-hub-proxy", nonce: "34" },
  ]);
  assert.equal(plan.startNonce, "33");
  assert.equal(plan.nextNonce, "35");
  assert.equal(plan.addresses.timelock, manifest.addresses.timelock);
  assert.equal(plan.addresses.codec, manifest.addresses.codec);
  assert.equal(plan.addresses.hubImplementation, manifest.addresses.hubImplementation);
  assert.notEqual(plan.addresses.contextRegistry, manifest.addresses.contextRegistry);
  assert.notEqual(plan.addresses.hubProxy, manifest.addresses.hubProxy);
});

test("preserves schema, EAS, NFTs, roles, and original manifest runtime hashes", () => {
  const config = createReplacementExecutionConfig(manifest);
  const plan = buildReplacementPlan(manifest, config, 33n, artifacts);

  assert.equal(plan.schema.uid, manifest.schema.uid);
  assert.equal(plan.schema.reused, true);
  assert.deepEqual(plan.existingContracts, manifest.existingContracts);
  assert.equal(plan.initialization.passport, manifest.existingContracts.passport);
  assert.equal(plan.initialization.stamp, manifest.existingContracts.stamp);
  assert.equal(plan.initialization.collectible, manifest.existingContracts.collectible);
  assert.equal(plan.initialization.writer, "0xd0f5dd0885ca87f2c9f4d1017fa1714dd98dc815");
  assert.equal(plan.initialization.admin, manifest.addresses.timelock);
  assert.equal(plan.artifacts.timelock.expectedRuntimeCodeHash, manifest.artifacts.timelock.expectedRuntimeCodeHash);
  assert.equal(plan.artifacts.codec.expectedRuntimeCodeHash, manifest.artifacts.codec.expectedRuntimeCodeHash);
  assert.equal(plan.artifacts.hubImplementation.expectedRuntimeCodeHash, manifest.artifacts.hubImplementation.expectedRuntimeCodeHash);
});

test("uses the distinct V2 environment and no replacement NFT or governance bootstrap", () => {
  const config = createReplacementExecutionConfig(manifest);
  const plan = buildReplacementPlan(manifest, config, 33n, artifacts);

  assert.equal(REPLACEMENT_ENVIRONMENT_LABEL, "byus:production:giwa-sepolia:action-ledger:v2");
  assert.equal(config.environmentId, REPLACEMENT_ENVIRONMENT_ID);
  assert.notEqual(config.environmentId, "0xf994dff6d9e127c91f54a46be6cb284f408669b5358950c1df07238f00acc7b9");
  assert.equal(plan.steps.some((step) => /nft|passport|stamp|timelock|codec|implementation/i.test(step.id)), false);
  assert.equal(plan.contextRegistry.constructor.admin, manifest.addresses.timelock);
  assert.equal(plan.contextRegistry.constructor.registrar, ADMIN);
  assert.equal(plan.followUp.unsignedNftMinterGrants.length, 2);
  assert.equal(plan.followUp.unsignedNftMinterGrants.every((grant) => grant.account === plan.addresses.hubProxy), true);
  assert.equal(plan.safety.automaticallyGrantsNftRoles, false);
  assert.equal(plan.safety.createsGovernanceBootstrapAdmin, false);
});

test("serializes the bounded execution guards and approved signer identities", () => {
  const config = createReplacementExecutionConfig(manifest);
  assert.equal(config.deployer, DEPLOYER);
  assert.equal(config.roles.governanceAdmin, ADMIN);
  assert.deepEqual(config.guards, {
    maxGasPerTransaction: 800_000n,
    maxFeePerGasWei: 10_000_000n,
    maxPriorityFeePerGasWei: 2_000_000n,
    maxTotalDeploymentFeeWei: 20_000_000_000_000n,
    gasLimitByStep: {
      "deploy-context-registry": 800_000n,
      "deploy-hub-proxy": 650_000n,
    },
  });
});

test("rejects a manifest that does not name the deployed original Hub", () => {
  const config = createReplacementExecutionConfig(manifest);
  assert.throws(
    () => buildReplacementPlan({ ...manifest, addresses: { ...manifest.addresses, hubProxy: "0x1111111111111111111111111111111111111111" } }, config, 33n, artifacts),
    /original Hub address/,
  );
});
