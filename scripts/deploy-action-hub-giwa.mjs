#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  padHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const GIWA_CHAIN_ID = 91_342;
export const TIMELOCK_DELAY_SECONDS = 172_800;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
export const ENVIRONMENT_LABEL = "byus:production:giwa-sepolia:action-ledger:v1";
export const ENVIRONMENT_ID = keccak256(new TextEncoder().encode(ENVIRONMENT_LABEL));
export const ACTION_SCHEMA = "bytes32 occurrenceId,bytes32 actionId,uint32 revision,uint16 actionCode,uint16 schemaVersion,uint32 policyVersion,bytes32 environmentId,bytes32 creatorId,bytes32 campaignId,uint32 occurredDay,uint8 origin,bytes32 evidenceCommitment,bytes32 credentialRefsHash,bytes32 migrationBatchId";
export const PINNED_TARGETS = Object.freeze({
  deployer: "0x6b411f5afc240680bb32df1b30be07692d5032b4",
  governanceAdmin: "0xeee82f960476c888950c798c444c1fd92cbbfe50",
  writer: "0xd0f5dd0885ca87f2c9f4d1017fa1714dd98dc815",
  eas: "0x4200000000000000000000000000000000000021",
  schemaRegistry: "0x4200000000000000000000000000000000000020",
  passport: "0x17f9fb7658a326dd88db523739c227faf50fca20",
  stamp: "0x1adcde3473c4e884e60205b397ece744d8892285",
  easVersion: "1.4.1-beta.3",
  schemaRegistryVersion: "1.3.1-beta.2",
});

const VERSION_ABI = parseAbi(["function version() view returns (string)"]);
const SCHEMA_REGISTRY_ABI = parseAbi([
  "function version() view returns (string)",
  "function register(string schema,address resolver,bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns ((bytes32 uid,address resolver,bool revocable,string schema))",
]);
const NFT_ADMIN_ABI = parseAbi(["function grantRole(bytes32 role,address account)"]);
const TIMELOCK_READ_ABI = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
]);
const CONTEXT_READ_ABI = parseAbi(["function admin() view returns (address)"]);
const HUB_READ_ABI = parseAbi([
  "function environmentId() view returns (bytes32)",
  "function eas() view returns (address)",
  "function getSchema(uint16 schemaVersion) view returns (bytes32)",
  "function getAssetBinding(uint32 bindingVersion,uint8 kind) view returns (address)",
]);
const MINTER_ROLE = keccak256(new TextEncoder().encode("MINTER_ROLE"));
const TIMELOCK_DEFAULT_ADMIN_ROLE = ZERO_BYTES32;
const TIMELOCK_PROPOSER_ROLE = keccak256(new TextEncoder().encode("PROPOSER_ROLE"));
const TIMELOCK_EXECUTOR_ROLE = keccak256(new TextEncoder().encode("EXECUTOR_ROLE"));
const HUB_STORAGE = 0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700n;
const HUB_ROLES_OFFSET = 9n;
const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const HUB_ROLES = Object.freeze({
  defaultAdmin: ZERO_BYTES32,
  writer: keccak256(new TextEncoder().encode("WRITER_ROLE")),
  migrator: keccak256(new TextEncoder().encode("MIGRATOR_ROLE")),
  corrector: keccak256(new TextEncoder().encode("CORRECTOR_ROLE")),
  pauser: keccak256(new TextEncoder().encode("PAUSER_ROLE")),
  upgrader: keccak256(new TextEncoder().encode("UPGRADER_ROLE")),
});

const DEFAULT_ARTIFACT_PATHS = Object.freeze({
  timelock: "contracts/out/TimelockController.sol/TimelockController.json",
  contextRegistry: "contracts/out/ByUsPublicContextRegistry.sol/ByUsPublicContextRegistry.json",
  codec: "contracts/out/ByUsActionCodec.sol/ByUsActionCodec.json",
  hubImplementation: "contracts/out/ByUsActionHub.sol/ByUsActionHub.json",
  proxy: "contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json",
});

function canonicalAddress(value, label) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} must be a valid address`);
  }
}

function bigintField(value, label) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a non-negative integer string`);
  }
}

function json(value) {
  return JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function objectBytecode(artifact, label, key = "bytecode") {
  const candidate = artifact?.[key]?.object ?? artifact?.[key];
  if (typeof candidate !== "string" || !candidate.startsWith("0x") || candidate.length <= 2) {
    throw new Error(`${label} artifact has no ${key}`);
  }
  if (candidate.includes("__$")) throw new Error(`${label} artifact has unresolved libraries`);
  return candidate;
}

export function validatePublicConfig(input) {
  if (!input || typeof input !== "object") throw new Error("config must be a JSON object");
  if (input.chainId !== GIWA_CHAIN_ID) throw new Error(`chainId must be ${GIWA_CHAIN_ID}`);
  if (typeof input.rpcUrl !== "string" || !input.rpcUrl.startsWith("https://")) {
    throw new Error("rpcUrl must be an https URL");
  }
  const deployer = canonicalAddress(input.deployer, "deployer");
  const roles = {
    governanceAdmin: canonicalAddress(input.roles?.governanceAdmin, "roles.governanceAdmin"),
    writer: canonicalAddress(input.roles?.writer, "roles.writer"),
    migrator: canonicalAddress(input.roles?.migrator, "roles.migrator"),
    corrector: canonicalAddress(input.roles?.corrector, "roles.corrector"),
    pauser: canonicalAddress(input.roles?.pauser, "roles.pauser"),
  };
  if (deployer !== PINNED_TARGETS.deployer) throw new Error("deployer must match the approved Dev relayer");
  if (roles.governanceAdmin !== PINNED_TARGETS.governanceAdmin) {
    throw new Error("governanceAdmin must match the approved Byus_Admin address");
  }
  if (roles.writer !== PINNED_TARGETS.writer) throw new Error("writer must match the approved Production writer");
  if ([roles.migrator, roles.corrector, roles.pauser, deployer].includes(roles.writer)) {
    throw new Error("writer must be separate from deployer, migrator, corrector, and pauser");
  }
  if (roles.governanceAdmin === deployer) {
    throw new Error("governanceAdmin must be separate from deployer");
  }
  if ([roles.migrator, roles.corrector, roles.pauser].some((address) => address !== roles.governanceAdmin)) {
    throw new Error("migrator, corrector, and pauser must match governanceAdmin for this deployment");
  }
  const existing = {
    eas: canonicalAddress(input.existing?.eas, "existing.eas"),
    schemaRegistry: canonicalAddress(input.existing?.schemaRegistry, "existing.schemaRegistry"),
    passport: canonicalAddress(input.existing?.passport, "existing.passport"),
    stamp: canonicalAddress(input.existing?.stamp, "existing.stamp"),
    ...(input.existing?.schemaUID ? { schemaUID: input.existing.schemaUID.toLowerCase() } : {}),
  };
  if (existing.eas !== PINNED_TARGETS.eas || existing.schemaRegistry !== PINNED_TARGETS.schemaRegistry) {
    throw new Error("EAS and SchemaRegistry addresses must match pinned GIWA targets");
  }
  if (existing.passport !== PINNED_TARGETS.passport || existing.stamp !== PINNED_TARGETS.stamp) {
    throw new Error("Passport and Stamp must match the approved existing contracts");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.environmentId ?? "")) {
    throw new Error("environmentId must be bytes32");
  }
  if (input.environmentId.toLowerCase() === ZERO_BYTES32) {
    throw new Error("environmentId must be non-zero");
  }
  if (input.environmentId.toLowerCase() !== ENVIRONMENT_ID) {
    throw new Error(`environmentId must equal keccak256(${ENVIRONMENT_LABEL})`);
  }
  const collectible = canonicalAddress(input.collectible ?? ZERO_ADDRESS, "collectible");
  if (collectible !== ZERO_ADDRESS) throw new Error("collectible must remain zero until Production approval");
  return {
    ...input,
    deployer,
    exclusiveWriterAssertion: input.exclusiveWriterAssertion
      ? canonicalAddress(input.exclusiveWriterAssertion, "exclusiveWriterAssertion")
      : undefined,
    roles,
    existing,
    collectible,
    environmentId: input.environmentId.toLowerCase(),
    guards: normalizeGuards(input.guards),
  };
}

export function normalizeGuards(input = {}) {
  return {
    maxGasPerTransaction: bigintField(input.maxGasPerTransaction, "guards.maxGasPerTransaction"),
    maxFeePerGasWei: bigintField(input.maxFeePerGasWei, "guards.maxFeePerGasWei"),
    maxPriorityFeePerGasWei: bigintField(input.maxPriorityFeePerGasWei, "guards.maxPriorityFeePerGasWei"),
    maxTotalDeploymentFeeWei: bigintField(input.maxTotalDeploymentFeeWei, "guards.maxTotalDeploymentFeeWei"),
    gasLimitByStep: Object.fromEntries(
      Object.entries(input.gasLimitByStep ?? {}).map(([key, value]) => [key, bigintField(value, `guards.gasLimitByStep.${key}`)]),
    ),
  };
}

export function assertExecutionAuthorization(config, exclusiveWriter) {
  const normalized = validatePublicConfig(config);
  const asserted = canonicalAddress(exclusiveWriter ?? normalized.exclusiveWriterAssertion, "exclusive writer assertion");
  if (asserted !== normalized.deployer) {
    throw new Error("exclusiveWriterAssertion must match deployer");
  }
  return normalized;
}

export function assertFeeGuards(transactions, guards) {
  let total = 0n;
  for (const transaction of transactions) {
    if (transaction.gas > guards.maxGasPerTransaction) {
      throw new Error(`${transaction.id} gas exceeds guard`);
    }
    if (transaction.maxFeePerGas > guards.maxFeePerGasWei) {
      throw new Error(`${transaction.id} max fee per gas exceeds guard`);
    }
    total += transaction.gas * transaction.maxFeePerGas;
  }
  if (total > guards.maxTotalDeploymentFeeWei) {
    throw new Error("total deployment fee exposure exceeds guard");
  }
  return total;
}

export function computeSchemaUID() {
  return keccak256(encodePacked(["string", "address", "bool"], [ACTION_SCHEMA, ZERO_ADDRESS, true]));
}

function patchSingleImmutable(deployedBytecode, immutableReferences, address) {
  const references = Object.values(immutableReferences ?? {}).flat();
  if (references.length === 0) return deployedBytecode;
  const replacement = padHex(address, { size: 32 }).slice(2);
  let body = deployedBytecode.slice(2);
  for (const reference of references) {
    if (reference.length !== 32) throw new Error("unsupported immutable reference width");
    const start = reference.start * 2;
    body = `${body.slice(0, start)}${replacement}${body.slice(start + reference.length * 2)}`;
  }
  return `0x${body}`;
}

function artifactSnapshot(artifacts, immutableAddresses) {
  return Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => {
    const bytecode = objectBytecode(artifact, name);
    const deployedBytecode = objectBytecode(artifact, name, "deployedBytecode");
    const expectedRuntime = patchSingleImmutable(
      deployedBytecode,
      artifact.deployedBytecode?.immutableReferences,
      immutableAddresses[name] ?? ZERO_ADDRESS,
    );
    return [name, {
      creationBytecodeHash: keccak256(bytecode),
      runtimeTemplateCodeHash: keccak256(deployedBytecode),
      expectedRuntimeCodeHash: keccak256(expectedRuntime),
      artifactSha256: artifact.__sha256 ?? null,
    }];
  }));
}

function deployStep(id, nonce, artifact, args = []) {
  return {
    id,
    nonce: nonce.toString(),
    to: null,
    value: "0",
    data: encodeDeployData({ abi: artifact.abi, bytecode: objectBytecode(artifact, id), args }),
  };
}

export function buildDeploymentPlan(rawConfig, options) {
  const config = validatePublicConfig(rawConfig);
  const startNonce = BigInt(options.startNonce);
  const artifacts = options.artifacts;
  const schemaUID = computeSchemaUID();
  if (config.existing.schemaUID && config.existing.schemaUID !== schemaUID) {
    throw new Error("configured schemaUID does not match the exact v1 schema");
  }
  const schemaNeedsRegistration = options.schemaExists !== true;
  let nonce = startNonce;
  const steps = [];
  if (schemaNeedsRegistration) {
    steps.push({
      id: "register-schema",
      nonce: (nonce++).toString(),
      to: config.existing.schemaRegistry,
      value: "0",
      data: encodeFunctionData({
        abi: SCHEMA_REGISTRY_ABI,
        functionName: "register",
        args: [ACTION_SCHEMA, ZERO_ADDRESS, true],
      }),
    });
  }

  const addressAt = (value) => getContractAddress({ from: config.deployer, nonce: value }).toLowerCase();
  const timelockNonce = nonce++;
  const contextNonce = nonce++;
  const codecNonce = nonce++;
  const implementationNonce = nonce++;
  const proxyNonce = nonce++;
  const addresses = {
    timelock: addressAt(timelockNonce),
    contextRegistry: addressAt(contextNonce),
    codec: addressAt(codecNonce),
    hubImplementation: addressAt(implementationNonce),
    hubProxy: addressAt(proxyNonce),
  };
  const timelock = {
    delaySeconds: TIMELOCK_DELAY_SECONDS,
    proposers: [config.roles.governanceAdmin],
    executors: [config.roles.governanceAdmin],
    bootstrapAdmin: ZERO_ADDRESS,
  };
  const initialization = {
    admin: addresses.timelock,
    writer: config.roles.writer,
    migrator: config.roles.migrator,
    corrector: config.roles.corrector,
    pauser: config.roles.pauser,
    easAddress: config.existing.eas,
    environmentId: config.environmentId,
    schemaUID,
    passport: config.existing.passport,
    stamp: config.existing.stamp,
    collectible: config.collectible,
    codec: addresses.codec,
    contextRegistry: addresses.contextRegistry,
  };
  const initializeData = encodeFunctionData({
    abi: artifacts.hubImplementation.abi,
    functionName: "initialize",
    args: [initialization],
  });
  steps.push(
    deployStep("deploy-timelock", timelockNonce, artifacts.timelock, [
      BigInt(TIMELOCK_DELAY_SECONDS), [config.roles.governanceAdmin], [config.roles.governanceAdmin], ZERO_ADDRESS,
    ]),
    deployStep("deploy-context-registry", contextNonce, artifacts.contextRegistry, [addresses.timelock]),
    deployStep("deploy-codec", codecNonce, artifacts.codec),
    deployStep("deploy-hub-implementation", implementationNonce, artifacts.hubImplementation),
    deployStep("deploy-hub-proxy", proxyNonce, artifacts.proxy, [addresses.hubImplementation, initializeData]),
  );

  const unsignedNftMinterGrants = [config.existing.passport, config.existing.stamp].map((target) => ({
    signer: config.roles.governanceAdmin,
    target,
    value: "0",
    calldata: encodeFunctionData({ abi: NFT_ADMIN_ABI, functionName: "grantRole", args: [MINTER_ROLE, addresses.hubProxy] }),
    role: MINTER_ROLE,
    account: addresses.hubProxy,
    status: "UNSIGNED_NOT_EXECUTED",
  }));

  return {
    format: "byus-action-hub-giwa-plan-v1",
    mode: "PLAN_ONLY",
    chainId: GIWA_CHAIN_ID,
    environment: config.environment,
    deployer: config.deployer,
    startNonce: startNonce.toString(),
    nextNonce: nonce.toString(),
    schema: { text: ACTION_SCHEMA, uid: schemaUID, resolver: ZERO_ADDRESS, revocable: true, reused: !schemaNeedsRegistration },
    timelock,
    existingContracts: { ...config.existing, collectible: config.collectible },
    addresses,
    initialization,
    guards: {
      maxGasPerTransaction: config.guards.maxGasPerTransaction.toString(),
      maxFeePerGasWei: config.guards.maxFeePerGasWei.toString(),
      maxPriorityFeePerGasWei: config.guards.maxPriorityFeePerGasWei.toString(),
      maxTotalDeploymentFeeWei: config.guards.maxTotalDeploymentFeeWei.toString(),
      gasLimitByStep: Object.fromEntries(
        Object.entries(config.guards.gasLimitByStep).map(([id, value]) => [id, value.toString()]),
      ),
    },
    artifacts: artifactSnapshot(artifacts, {
      contextRegistry: addresses.timelock,
      hubImplementation: addresses.hubImplementation,
    }),
    steps,
    followUp: {
      unsignedNftMinterGrants,
      contextRegistrationTemplate: {
        status: "UNSIGNED_NOT_SCHEDULED",
        timelock: addresses.timelock,
        target: addresses.contextRegistry,
        value: "0",
        predecessor: ZERO_BYTES32,
        salt: "SET_AT_SCHEDULING_TIME",
        delaySeconds: TIMELOCK_DELAY_SECONDS,
        operations: [
          { signature: "registerCreator(bytes32,string)", args: ["CREATOR_ID", "PUBLIC_SLUG"] },
          { signature: "registerCampaign(bytes32,bytes32,string)", args: ["CAMPAIGN_ID", "CREATOR_ID", "PUBLIC_SLUG"] },
        ],
      },
    },
    safety: {
      deploysReplacementNfts: false,
      automaticallyGrantsNftRoles: false,
      automaticallySchedulesContexts: false,
    },
  };
}

export function fixtureArtifactsForTests() {
  const constructor = (inputs = []) => ({ type: "constructor", stateMutability: "nonpayable", inputs });
  const emptyRuntime = "0x60006000f3";
  const base = (abi) => ({ abi, bytecode: { object: "0x60006000f3" }, deployedBytecode: { object: emptyRuntime } });
  return {
    timelock: base([constructor([
      { name: "minDelay", type: "uint256" }, { name: "proposers", type: "address[]" },
      { name: "executors", type: "address[]" }, { name: "admin", type: "address" },
    ])]),
    contextRegistry: base([constructor([{ name: "admin_", type: "address" }])]),
    codec: base([constructor()]),
    hubImplementation: base([
      constructor(),
      parseAbiItem("function initialize((address admin,address writer,address migrator,address corrector,address pauser,address easAddress,bytes32 environmentId,bytes32 schemaUID,address passport,address stamp,address collectible,address codec,address contextRegistry) config)"),
    ]),
    proxy: base([constructor([{ name: "implementation", type: "address" }, { name: "_data", type: "bytes" }])]),
  };
}

async function loadArtifacts(root, overrides = {}) {
  const entries = await Promise.all(Object.entries(DEFAULT_ARTIFACT_PATHS).map(async ([name, relative]) => {
    const artifactPath = resolve(root, overrides[name] ?? relative);
    const raw = await readFile(artifactPath, "utf8");
    return [name, { ...JSON.parse(raw), __path: artifactPath, __sha256: sha256(raw) }];
  }));
  return Object.fromEntries(entries);
}

async function inspectTargets(client, config, schemaUID) {
  const chainId = await client.getChainId();
  if (chainId !== GIWA_CHAIN_ID) throw new Error(`RPC chainId is ${chainId}; expected ${GIWA_CHAIN_ID}`);
  const addresses = {
    eas: config.existing.eas,
    schemaRegistry: config.existing.schemaRegistry,
    passport: config.existing.passport,
    stamp: config.existing.stamp,
  };
  const codes = Object.fromEntries(await Promise.all(Object.entries(addresses).map(async ([name, address]) => {
    const code = await client.getBytecode({ address });
    if (!code || code === "0x") throw new Error(`${name} has no code at ${address}`);
    return [name, { address, runtimeCodeHash: keccak256(code) }];
  })));
  const [easVersion, schemaRegistryVersion, schemaRecord] = await Promise.all([
    client.readContract({ address: config.existing.eas, abi: VERSION_ABI, functionName: "version" }),
    client.readContract({ address: config.existing.schemaRegistry, abi: VERSION_ABI, functionName: "version" }),
    client.readContract({ address: config.existing.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: "getSchema", args: [schemaUID] }),
  ]);
  if (easVersion !== PINNED_TARGETS.easVersion) throw new Error(`unexpected EAS version ${easVersion}`);
  if (schemaRegistryVersion !== PINNED_TARGETS.schemaRegistryVersion) {
    throw new Error(`unexpected SchemaRegistry version ${schemaRegistryVersion}`);
  }
  const { uid, resolver, revocable, schema } = Array.isArray(schemaRecord)
    ? { uid: schemaRecord[0], resolver: schemaRecord[1], revocable: schemaRecord[2], schema: schemaRecord[3] }
    : schemaRecord;
  const schemaExists = uid.toLowerCase() === schemaUID && schema === ACTION_SCHEMA
    && resolver.toLowerCase() === ZERO_ADDRESS && revocable === true;
  if (uid !== ZERO_BYTES32 && !schemaExists) throw new Error("computed schema UID resolves to an unexpected schema record");
  return { chainId, versions: { eas: easVersion, schemaRegistry: schemaRegistryVersion }, codes, schemaExists };
}

export function assertTargetSnapshot(reviewed, current) {
  if (reviewed.versions.eas !== current.versions.eas
      || reviewed.versions.schemaRegistry !== current.versions.schemaRegistry) {
    throw new Error("target version changed after plan review");
  }
  for (const [name, expected] of Object.entries(reviewed.codes)) {
    const actual = current.codes[name];
    if (!actual || expected.address !== actual.address || expected.runtimeCodeHash !== actual.runtimeCodeHash) {
      throw new Error(`target code changed after plan review: ${name}`);
    }
  }
}

export function assertPostflightGovernance(readback, expectedImplementation) {
  if (readback.deployerHasTimelockAdmin || readback.governanceAdminHasTimelockAdmin
      || readback.hubRoles.deployerHasAnyRole) {
    throw new Error("residual deployer governance detected");
  }
  if (readback.timelockDelay !== BigInt(TIMELOCK_DELAY_SECONDS)
      || !readback.governanceAdminIsProposer || !readback.governanceAdminIsExecutor
      || !readback.hubRoles.expectedAssignments) {
    throw new Error("governance role or delay readback failed");
  }
  if (readback.proxyImplementation.toLowerCase() !== expectedImplementation.toLowerCase()) {
    throw new Error("ERC1967 implementation slot does not match planned implementation");
  }
}

export function hubRoleStorageSlot(role, account) {
  const outer = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }],
    [role, HUB_STORAGE + HUB_ROLES_OFFSET],
  ));
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [account, outer]));
}

async function readHubRole(client, hub, role, account) {
  const value = await client.getStorageAt({ address: hub, slot: hubRoleStorageSlot(role, account) });
  return value !== undefined && BigInt(value) !== 0n;
}

function parseEnv(raw) {
  const result = {};
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("env file contains an invalid line");
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

async function atomicWrite(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${json(value)}\n`, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function planHash(plan) {
  return sha256(json(plan));
}

export function reconcileJournalStep(step, rpc) {
  if (step.status === "confirmed" && rpc.receipt?.status === "success") return { action: "confirmed" };
  if (rpc.receipt?.status === "success") return { action: "record-receipt", receipt: rpc.receipt };
  if (rpc.receipt?.status === "reverted") return { action: "stop-reverted" };
  if (rpc.transaction) return { action: "wait-existing", txHash: step.txHash };
  return { action: "stop-uncertain", reason: "signed transaction is absent from RPC; never re-sign this nonce" };
}

async function loadAccount(envFile, keyName, expectedAddress) {
  if (!envFile || !keyName) throw new Error("--env-file and --key-name are required for execute/resume");
  const values = parseEnv(await readFile(resolve(envFile), "utf8"));
  const privateKey = values[keyName];
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) throw new Error(`key ${keyName} is missing or invalid`);
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== expectedAddress) throw new Error("private key address does not match deployer");
  return account;
}

async function readRpcState(client, txHash) {
  let receipt = null;
  let transaction = null;
  try { receipt = await client.getTransactionReceipt({ hash: txHash }); } catch (error) {
    if (!/not found|could not be found/i.test(error.shortMessage ?? error.message)) throw error;
  }
  if (!receipt) {
    try { transaction = await client.getTransaction({ hash: txHash }); } catch (error) {
      if (!/not found|could not be found/i.test(error.shortMessage ?? error.message)) throw error;
    }
  }
  return { receipt, transaction };
}

async function waitForReceipt(client, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return receipt;
}

export async function executePlan({ client, account, config, plan, journalPath, manifestPath, targetSnapshot }) {
  const expectedPlanHash = planHash(plan);
  let journal;
  try { journal = await readJson(journalPath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    journal = { format: "byus-action-hub-giwa-journal-v1", chainId: GIWA_CHAIN_ID, planHash: expectedPlanHash, steps: [] };
  }
  if (journal.planHash !== expectedPlanHash || journal.chainId !== GIWA_CHAIN_ID) {
    throw new Error("journal does not belong to this exact deployment plan");
  }
  if (journal.steps.length === 0 && targetSnapshot.schemaExists === !plan.schema.reused) {
    throw new Error("schema registration state changed after plan review; create and review a new plan");
  }
  const configuredExposure = plan.steps.map((step) => {
    const gas = config.guards.gasLimitByStep[step.id];
    if (!gas) throw new Error(`guards.gasLimitByStep.${step.id} is required for execution`);
    return { id: step.id, gas, maxFeePerGas: config.guards.maxFeePerGasWei };
  });
  assertFeeGuards(configuredExposure, config.guards);

  const manifest = {
    format: "byus-action-hub-giwa-manifest-v1",
    chainId: GIWA_CHAIN_ID,
    environment: plan.environment,
    planHash: expectedPlanHash,
    proxyBlock: null,
    addresses: plan.addresses,
    existingContracts: plan.existingContracts,
    schema: plan.schema,
    artifacts: plan.artifacts,
    transactions: [],
    gas: { totalUsed: "0", totalPaidWei: "0", maximumAuthorizedExposureWei: assertFeeGuards(configuredExposure, config.guards).toString() },
    followUp: plan.followUp,
    postflight: null,
  };

  for (const step of plan.steps) {
    let saved = journal.steps.find((entry) => entry.id === step.id);
    if (saved) {
      const rpc = await readRpcState(client, saved.txHash);
      const resolution = reconcileJournalStep(saved, rpc);
      if (resolution.action === "stop-uncertain" || resolution.action === "stop-reverted") {
        throw new Error(resolution.reason ?? `${step.id} reverted`);
      }
      const receipt = rpc.receipt ?? await waitForReceipt(client, saved.txHash);
      saved = { ...saved, status: "confirmed", receipt: compactReceipt(receipt) };
      journal.steps = journal.steps.map((entry) => entry.id === step.id ? saved : entry);
      await atomicWrite(journalPath, journal, 0o600);
      continue;
    }

    const [latestNonce, pendingNonce] = await Promise.all([
      client.getTransactionCount({ address: account.address, blockTag: "latest" }),
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    ]);
    const expectedNonce = Number(step.nonce);
    if (latestNonce !== pendingNonce || latestNonce !== expectedNonce) {
      throw new Error(`${step.id}: pending nonce must equal latest nonce and expected nonce before signing`);
    }
    const estimatedFees = await client.estimateFeesPerGas({ type: "eip1559" });
    const maxFeePerGas = estimatedFees.maxFeePerGas;
    const maxPriorityFeePerGas = estimatedFees.maxPriorityFeePerGas;
    if (!maxFeePerGas || !maxPriorityFeePerGas) throw new Error("RPC did not return EIP-1559 fees");
    const gas = config.guards.gasLimitByStep[step.id];
    const estimatedGas = await client.estimateGas({
      account: account.address,
      data: step.data,
      value: 0n,
      ...(step.to ? { to: step.to } : {}),
    });
    if (estimatedGas > gas) {
      throw new Error(`${step.id} estimated gas ${estimatedGas} exceeds configured gas limit ${gas}`);
    }
    assertFeeGuards([{ id: step.id, gas, maxFeePerGas }], config.guards);
    if (maxPriorityFeePerGas > config.guards.maxPriorityFeePerGasWei) {
      throw new Error(`${step.id} priority fee exceeds guard`);
    }
    const transaction = {
      chainId: GIWA_CHAIN_ID,
      type: "eip1559",
      nonce: expectedNonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      value: 0n,
      data: step.data,
      ...(step.to ? { to: step.to } : {}),
    };
    const signedRawTransaction = await account.signTransaction(transaction);
    const txHash = keccak256(signedRawTransaction);
    saved = {
      id: step.id,
      nonce: step.nonce,
      status: "signed",
      txHash,
      signedRawTransaction,
      gas: gas.toString(),
      estimatedGas: estimatedGas.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    };
    journal.steps.push(saved);
    await atomicWrite(journalPath, journal, 0o600);
    const broadcastHash = await client.sendRawTransaction({ serializedTransaction: signedRawTransaction });
    if (broadcastHash !== txHash) throw new Error(`${step.id}: RPC returned a different transaction hash`);
    const receipt = await waitForReceipt(client, txHash);
    saved = { ...saved, status: "confirmed", receipt: compactReceipt(receipt) };
    journal.steps = journal.steps.map((entry) => entry.id === step.id ? saved : entry);
    await atomicWrite(journalPath, journal, 0o600);
  }

  const confirmed = journal.steps.map((entry) => ({
    id: entry.id,
    nonce: entry.nonce,
    txHash: entry.txHash,
    estimatedGas: entry.estimatedGas,
    gasLimit: entry.gas,
    maxFeePerGas: entry.maxFeePerGas,
    maxPriorityFeePerGas: entry.maxPriorityFeePerGas,
    blockNumber: entry.receipt.blockNumber,
    gasUsed: entry.receipt.gasUsed,
    effectiveGasPrice: entry.receipt.effectiveGasPrice,
  }));
  manifest.transactions = confirmed;
  manifest.proxyBlock = confirmed.find((entry) => entry.id === "deploy-hub-proxy")?.blockNumber ?? null;
  manifest.gas.totalUsed = confirmed.reduce((sum, entry) => sum + BigInt(entry.gasUsed), 0n).toString();
  manifest.gas.totalPaidWei = confirmed.reduce((sum, entry) => sum + BigInt(entry.gasUsed) * BigInt(entry.effectiveGasPrice), 0n).toString();
  manifest.postflight = await verifyDeployment(client, config, plan);
  await atomicWrite(manifestPath, manifest, 0o644);
  return manifest;
}

export async function verifyDeployment(client, config, plan) {
  const deployedCodes = Object.fromEntries(await Promise.all(Object.entries(plan.addresses).map(async ([name, address]) => {
    const code = await client.getBytecode({ address });
    if (!code || code === "0x") throw new Error(`postflight: ${name} has no deployed code`);
    return [name, { address, runtimeCodeHash: keccak256(code) }];
  })));
  const expectedHubAssignments = [
    [HUB_ROLES.defaultAdmin, plan.addresses.timelock],
    [HUB_ROLES.upgrader, plan.addresses.timelock],
    [HUB_ROLES.writer, config.roles.writer],
    [HUB_ROLES.migrator, config.roles.migrator],
    [HUB_ROLES.corrector, config.roles.corrector],
    [HUB_ROLES.pauser, config.roles.pauser],
  ];
  const [delay, deployerAdmin, governanceAdminIsAdmin, proposer, executor, contextAdmin, environmentId, eas, schemaUID, passport, stamp, collectible, implementationWord, expectedRoleValues, deployerRoleValues] = await Promise.all([
    client.readContract({ address: plan.addresses.timelock, abi: TIMELOCK_READ_ABI, functionName: "getMinDelay" }),
    client.readContract({ address: plan.addresses.timelock, abi: TIMELOCK_READ_ABI, functionName: "hasRole", args: [TIMELOCK_DEFAULT_ADMIN_ROLE, config.deployer] }),
    client.readContract({ address: plan.addresses.timelock, abi: TIMELOCK_READ_ABI, functionName: "hasRole", args: [TIMELOCK_DEFAULT_ADMIN_ROLE, config.roles.governanceAdmin] }),
    client.readContract({ address: plan.addresses.timelock, abi: TIMELOCK_READ_ABI, functionName: "hasRole", args: [TIMELOCK_PROPOSER_ROLE, config.roles.governanceAdmin] }),
    client.readContract({ address: plan.addresses.timelock, abi: TIMELOCK_READ_ABI, functionName: "hasRole", args: [TIMELOCK_EXECUTOR_ROLE, config.roles.governanceAdmin] }),
    client.readContract({ address: plan.addresses.contextRegistry, abi: CONTEXT_READ_ABI, functionName: "admin" }),
    client.readContract({ address: plan.addresses.hubProxy, abi: HUB_READ_ABI, functionName: "environmentId" }),
    client.readContract({ address: plan.addresses.hubProxy, abi: HUB_READ_ABI, functionName: "eas" }),
    client.readContract({ address: plan.addresses.hubProxy, abi: HUB_READ_ABI, functionName: "getSchema", args: [1] }),
    client.readContract({ address: plan.addresses.hubProxy, abi: HUB_READ_ABI, functionName: "getAssetBinding", args: [1, 0] }),
    client.readContract({ address: plan.addresses.hubProxy, abi: HUB_READ_ABI, functionName: "getAssetBinding", args: [1, 1] }),
    client.readContract({ address: plan.addresses.hubProxy, abi: HUB_READ_ABI, functionName: "getAssetBinding", args: [1, 2] }),
    client.getStorageAt({ address: plan.addresses.hubProxy, slot: ERC1967_IMPLEMENTATION_SLOT }),
    Promise.all(expectedHubAssignments.map(([role, account]) => readHubRole(client, plan.addresses.hubProxy, role, account))),
    Promise.all(Object.values(HUB_ROLES).map((role) => readHubRole(client, plan.addresses.hubProxy, role, config.deployer))),
  ]);
  const proxyImplementation = canonicalAddress(`0x${implementationWord.slice(-40)}`, "proxy implementation slot");
  const governanceReadback = {
    timelockDelay: delay,
    deployerHasTimelockAdmin: deployerAdmin,
    governanceAdminHasTimelockAdmin: governanceAdminIsAdmin,
    governanceAdminIsProposer: proposer,
    governanceAdminIsExecutor: executor,
    proxyImplementation,
    hubRoles: {
      expectedAssignments: expectedRoleValues.every(Boolean),
      deployerHasAnyRole: deployerRoleValues.some(Boolean),
    },
  };
  assertPostflightGovernance(governanceReadback, plan.addresses.hubImplementation);
  const assertions = {
    timelockDelay: delay === BigInt(TIMELOCK_DELAY_SECONDS),
    deployerHasNoTimelockAdmin: deployerAdmin === false,
    governanceAdminHasNoDirectTimelockAdmin: governanceAdminIsAdmin === false,
    governanceAdminIsProposer: proposer === true,
    governanceAdminIsExecutor: executor === true,
    contextRegistryAdminIsTimelock: contextAdmin.toLowerCase() === plan.addresses.timelock,
    hubEnvironmentMatches: environmentId.toLowerCase() === config.environmentId,
    hubEasMatches: eas.toLowerCase() === config.existing.eas,
    hubSchemaMatches: schemaUID.toLowerCase() === plan.schema.uid,
    hubPassportMatches: passport.toLowerCase() === config.existing.passport,
    hubStampMatches: stamp.toLowerCase() === config.existing.stamp,
    hubCollectibleMatches: collectible.toLowerCase() === config.collectible,
    deployedRuntimeHashesMatch: Object.entries(deployedCodes).every(([name, record]) => {
      const artifactName = name === "hubProxy" ? "proxy" : name;
      return record.runtimeCodeHash === plan.artifacts[artifactName].expectedRuntimeCodeHash;
    }),
  };
  const failed = Object.entries(assertions).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) throw new Error(`postflight assertions failed: ${failed.join(", ")}`);
  return { assertions, governance: governanceReadback, deployedCodes };
}

function compactReceipt(receipt) {
  return {
    status: receipt.status,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress ?? null,
  };
}

function parseArgs(argv) {
  const parsed = { execute: false, resume: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--resume") { parsed.execute = true; parsed.resume = true; }
    else if (arg === "--help") parsed.help = true;
    else if (arg.startsWith("--")) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      parsed[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else throw new Error(`unexpected argument ${arg}`);
  }
  return parsed;
}

function usage() {
  return `Usage:\n  node scripts/deploy-action-hub-giwa.mjs --config <public.json> --plan-out <plan.json>\n  node scripts/deploy-action-hub-giwa.mjs --config <public.json> --plan-out <reviewed-plan.json> --execute --env-file <secrets.env> --key-name <ENV_KEY> --exclusive-writer <deployer> --journal <private.json> --manifest <public.json>\n  node scripts/deploy-action-hub-giwa.mjs --config <public.json> --plan-out <reviewed-plan.json> --resume --env-file <secrets.env> --key-name <ENV_KEY> --exclusive-writer <deployer> --journal <private.json> --manifest <public.json>\n\nThe default is read-only plan mode. Execute/resume load the existing reviewed plan. A signed but RPC-unknown journal entry stops execution and is never re-signed.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }
  if (!args.config || !args.planOut) throw new Error("--config and --plan-out are required");
  const configPath = resolve(args.config);
  const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
  const config = args.execute
    ? assertExecutionAuthorization(rawConfig, args.exclusiveWriter)
    : validatePublicConfig(rawConfig);
  const client = createPublicClient({ transport: http(config.rpcUrl, { retryCount: 0, timeout: 15_000 }) });
  const targetSnapshot = await inspectTargets(client, config, computeSchemaUID());
  const [latestNonce, pendingNonce] = await Promise.all([
    client.getTransactionCount({ address: config.deployer, blockTag: "latest" }),
    client.getTransactionCount({ address: config.deployer, blockTag: "pending" }),
  ]);
  const configSha256 = sha256(await readFile(configPath));
  const cliSha256 = sha256(await readFile(new URL(import.meta.url)));
  let plan;
  if (!args.execute) {
    const artifacts = await loadArtifacts(process.cwd(), config.artifacts);
    plan = buildDeploymentPlan(config, { startNonce: pendingNonce, artifacts, schemaExists: targetSnapshot.schemaExists });
    plan.configSha256 = configSha256;
    plan.cliSha256 = cliSha256;
    plan.environmentIdentity = { label: ENVIRONMENT_LABEL, id: ENVIRONMENT_ID };
    plan.targetSnapshot = targetSnapshot;
    plan.nonceSnapshot = { latest: latestNonce.toString(), pending: pendingNonce.toString(), equal: latestNonce === pendingNonce };
    await atomicWrite(resolve(args.planOut), plan, 0o644);
    process.stdout.write(`PLAN_WRITTEN ${resolve(args.planOut)}\n`);
    process.stdout.write(`PLAN_HASH ${planHash(plan)}\n`);
    process.stdout.write("MODE PLAN_ONLY (no transaction signed or broadcast)\n");
    return;
  }
  if (!args.journal || !args.manifest) throw new Error("--journal and --manifest are required for execute/resume");
  plan = await readJson(resolve(args.planOut));
  if (plan.format !== "byus-action-hub-giwa-plan-v1" || plan.chainId !== GIWA_CHAIN_ID) {
    throw new Error("--plan-out is not a GIWA ActionHub deployment plan");
  }
  if (plan.configSha256 !== configSha256) throw new Error("public config changed after plan review");
  if (plan.cliSha256 !== cliSha256) throw new Error("deployment CLI changed after plan review");
  assertTargetSnapshot(plan.targetSnapshot, targetSnapshot);
  process.stdout.write(`PLAN_LOADED ${resolve(args.planOut)}\n`);
  process.stdout.write(`PLAN_HASH ${planHash(plan)}\n`);
  const account = await loadAccount(args.envFile, args.keyName, config.deployer);
  const manifest = await executePlan({
    client,
    account,
    config,
    plan,
    journalPath: resolve(args.journal),
    manifestPath: resolve(args.manifest),
    targetSnapshot,
  });
  process.stdout.write(`DEPLOYMENT_CONFIRMED ${resolve(args.manifest)}\n`);
  process.stdout.write(`HUB_PROXY ${manifest.addresses.hubProxy}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`ERROR ${error.message}\n`);
    process.exitCode = 1;
  });
}
