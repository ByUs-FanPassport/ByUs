#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  padHex,
} from "viem";

import {
  ACTION_SCHEMA,
  GIWA_CHAIN_ID,
  PINNED_TARGETS,
  ZERO_ADDRESS,
  validatePublicConfig,
} from "./deploy-action-hub-giwa.mjs";

export const REPLACEMENT_ENVIRONMENT_LABEL = "byus:production:giwa-sepolia:action-ledger:v2";
export const REPLACEMENT_ENVIRONMENT_ID = keccak256(new TextEncoder().encode(REPLACEMENT_ENVIRONMENT_LABEL));

const ORIGINAL = Object.freeze({
  hubProxy: "0x7e076e9e7583fa9de2a944fbee8fa84d5d27504c",
  hubImplementation: "0x049b758b3d1cc0c66408b264c7f9a96ea479860b",
  timelock: "0x40eaeb0b73c50da5053502eb3b836a6effe54642",
  contextRegistry: "0xeacd59a9388c962885201f0d708cb3dd54b1761b",
  codec: "0x4e44a1c183bac430f30033bd1a639c696b93612a",
  schemaUID: "0xbd97671d89c9f4bb246e33369389332486f406ab821a0c7f88860034759c5c0b",
});
const ORIGINAL_RUNTIME_HASHES = Object.freeze({
  timelock: "0x0e3a4d6350ada4a2eb17e084770058b2b6f5bb487036eb19b0de7f1363f63900",
  codec: "0xe3095c9a1847be6e857e06f7182d417597094331c3a2ab5b2058253ab248bc39",
  hubImplementation: "0x3e50e0def7b3823e63bca919f5ecc1a09a709b4b62eb7dae1c710cb1c20d17d9",
  proxy: "0x2373de27ebdd05a3665c30eb6afdc555833cb5e0f60a663ff23f0f2825a412a7",
});

const ARTIFACT_PATHS = Object.freeze({
  contextRegistry: "contracts/out/ByUsPublicContextRegistryV2.sol/ByUsPublicContextRegistryV2.json",
  hubImplementation: "contracts/out/ByUsActionHub.sol/ByUsActionHub.json",
  proxy: "contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json",
});

const MINTER_ROLE = keccak256(new TextEncoder().encode("MINTER_ROLE"));
const NFT_ROLE_ABI = [{
  type: "function",
  name: "grantRole",
  stateMutability: "nonpayable",
  inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }],
  outputs: [],
}];

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function json(value) {
  return JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);
}

function bytecode(artifact, key) {
  const value = artifact?.[key]?.object;
  if (typeof value !== "string" || !value.startsWith("0x") || value.length <= 2) {
    throw new Error(`artifact is missing ${key}`);
  }
  return value;
}

function patchImmutable(artifact, address) {
  let body = bytecode(artifact, "deployedBytecode").slice(2);
  const replacement = padHex(address, { size: 32 }).slice(2);
  const references = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
  if (references.length === 0) throw new Error("V2 registry artifact must contain its immutable admin references");
  for (const reference of references) {
    if (reference.length !== 32) throw new Error("unsupported V2 registry immutable width");
    const start = reference.start * 2;
    body = `${body.slice(0, start)}${replacement}${body.slice(start + 64)}`;
  }
  return `0x${body}`;
}

function artifactRecord(artifact, expectedRuntime) {
  return {
    creationBytecodeHash: keccak256(bytecode(artifact, "bytecode")),
    runtimeTemplateCodeHash: keccak256(bytecode(artifact, "deployedBytecode")),
    expectedRuntimeCodeHash: keccak256(expectedRuntime),
    artifactSha256: artifact.__sha256,
  };
}

function assertOriginalManifest(manifest) {
  if (manifest?.format !== "byus-action-hub-giwa-manifest-v1" || manifest.chainId !== GIWA_CHAIN_ID) {
    throw new Error("original deployment manifest format or chain is invalid");
  }
  for (const [name, expected] of Object.entries(ORIGINAL)) {
    const actual = name === "schemaUID" ? manifest.schema?.uid : manifest.addresses?.[name];
    if (actual?.toLowerCase() !== expected) throw new Error(`original ${name === "hubProxy" ? "Hub address" : name} does not match the approved deployment`);
  }
  for (const name of ["timelock", "codec", "hubImplementation"]) {
    const expected = manifest.postflight?.deployedCodes?.[name]?.runtimeCodeHash;
    if (!expected || expected !== ORIGINAL_RUNTIME_HASHES[name]
        || manifest.artifacts?.[name]?.expectedRuntimeCodeHash !== expected) {
      throw new Error(`original manifest ${name} runtime hash is not self-consistent`);
    }
  }
  if (manifest.schema.text !== ACTION_SCHEMA || manifest.schema.reused !== false) {
    throw new Error("original manifest schema is not the approved first deployment");
  }
  if (manifest.postflight?.assertions?.deployedRuntimeHashesMatch !== true) {
    throw new Error("original manifest lacks successful runtime verification");
  }
}

export async function loadReplacementArtifacts(root = process.cwd()) {
  const rootPath = root instanceof URL ? fileURLToPath(root) : resolve(root);
  const entries = await Promise.all(Object.entries(ARTIFACT_PATHS).map(async ([name, relativePath]) => {
    const raw = await readFile(resolve(rootPath, relativePath), "utf8");
    return [name, { ...JSON.parse(raw), __sha256: sha256(raw) }];
  }));
  return Object.fromEntries(entries);
}

export function createReplacementExecutionConfig(manifest, rpcUrl = "https://sepolia-rpc.giwa.io") {
  assertOriginalManifest(manifest);
  const validatedV1 = validatePublicConfig({
    chainId: GIWA_CHAIN_ID,
    rpcUrl,
    environment: "production",
    deployer: PINNED_TARGETS.deployer,
    exclusiveWriterAssertion: PINNED_TARGETS.deployer,
    roles: {
      governanceAdmin: PINNED_TARGETS.governanceAdmin,
      writer: PINNED_TARGETS.writer,
      migrator: PINNED_TARGETS.governanceAdmin,
      corrector: PINNED_TARGETS.governanceAdmin,
      pauser: PINNED_TARGETS.governanceAdmin,
    },
    existing: {
      eas: manifest.existingContracts.eas,
      schemaRegistry: manifest.existingContracts.schemaRegistry,
      passport: manifest.existingContracts.passport,
      stamp: manifest.existingContracts.stamp,
      schemaUID: manifest.schema.uid,
    },
    collectible: manifest.existingContracts.collectible,
    environmentId: "0xf994dff6d9e127c91f54a46be6cb284f408669b5358950c1df07238f00acc7b9",
    guards: {
      maxGasPerTransaction: "800000",
      maxFeePerGasWei: "10000000",
      maxPriorityFeePerGasWei: "2000000",
      maxTotalDeploymentFeeWei: "20000000000000",
      gasLimitByStep: {
        "deploy-context-registry": "800000",
        "deploy-hub-proxy": "650000",
      },
    },
  });
  return { ...validatedV1, environmentId: REPLACEMENT_ENVIRONMENT_ID };
}

export function serializeReplacementConfig(config) {
  return JSON.parse(json(config));
}

export function buildReplacementPlan(manifest, config, startNonce, artifacts) {
  assertOriginalManifest(manifest);
  if (config.environmentId !== REPLACEMENT_ENVIRONMENT_ID) throw new Error("replacement environment ID is invalid");
  if (config.deployer !== PINNED_TARGETS.deployer || config.roles.governanceAdmin !== PINNED_TARGETS.governanceAdmin) {
    throw new Error("replacement signer identities do not match the approved deployment");
  }
  const nonce = BigInt(startNonce);
  const contextRegistry = getContractAddress({ from: config.deployer, nonce }).toLowerCase();
  const hubProxy = getContractAddress({ from: config.deployer, nonce: nonce + 1n }).toLowerCase();
  const addresses = {
    timelock: manifest.addresses.timelock,
    contextRegistry,
    codec: manifest.addresses.codec,
    hubImplementation: manifest.addresses.hubImplementation,
    hubProxy,
  };
  const initialization = {
    admin: addresses.timelock,
    writer: config.roles.writer,
    migrator: config.roles.migrator,
    corrector: config.roles.corrector,
    pauser: config.roles.pauser,
    easAddress: manifest.existingContracts.eas,
    environmentId: REPLACEMENT_ENVIRONMENT_ID,
    schemaUID: manifest.schema.uid,
    passport: manifest.existingContracts.passport,
    stamp: manifest.existingContracts.stamp,
    collectible: manifest.existingContracts.collectible,
    codec: addresses.codec,
    contextRegistry,
  };
  const initializeData = encodeFunctionData({
    abi: artifacts.hubImplementation.abi,
    functionName: "initialize",
    args: [initialization],
  });
  const contextData = encodeDeployData({
    abi: artifacts.contextRegistry.abi,
    bytecode: bytecode(artifacts.contextRegistry, "bytecode"),
    args: [addresses.timelock, config.roles.governanceAdmin],
  });
  const proxyData = encodeDeployData({
    abi: artifacts.proxy.abi,
    bytecode: bytecode(artifacts.proxy, "bytecode"),
    args: [addresses.hubImplementation, initializeData],
  });
  const unsignedNftMinterGrants = [manifest.existingContracts.passport, manifest.existingContracts.stamp].map((target) => ({
    signer: config.roles.governanceAdmin,
    target,
    value: "0",
    calldata: encodeFunctionData({ abi: NFT_ROLE_ABI, functionName: "grantRole", args: [MINTER_ROLE, hubProxy] }),
    role: MINTER_ROLE,
    account: hubProxy,
    status: "UNSIGNED_NOT_EXECUTED",
  }));
  const proxyRuntime = bytecode(artifacts.proxy, "deployedBytecode");
  if (keccak256(proxyRuntime) !== ORIGINAL_RUNTIME_HASHES.proxy) {
    throw new Error("current ERC1967Proxy artifact does not match the original deployed proxy code");
  }
  return {
    format: "byus-action-hub-giwa-plan-v1",
    mode: "PLAN_ONLY",
    replacementForHub: manifest.addresses.hubProxy,
    chainId: GIWA_CHAIN_ID,
    environment: "production",
    environmentIdentity: { label: REPLACEMENT_ENVIRONMENT_LABEL, id: REPLACEMENT_ENVIRONMENT_ID },
    deployer: config.deployer,
    startNonce: nonce.toString(),
    nextNonce: (nonce + 2n).toString(),
    schema: { ...manifest.schema, reused: true },
    existingContracts: { ...manifest.existingContracts, schemaRegistry: manifest.existingContracts.schemaRegistry },
    addresses,
    initialization,
    contextRegistry: {
      version: "V2",
      constructor: { admin: addresses.timelock, registrar: config.roles.governanceAdmin },
    },
    guards: serializeReplacementConfig(config.guards),
    artifacts: {
      timelock: manifest.artifacts.timelock,
      contextRegistry: artifactRecord(artifacts.contextRegistry, patchImmutable(artifacts.contextRegistry, addresses.timelock)),
      codec: manifest.artifacts.codec,
      hubImplementation: manifest.artifacts.hubImplementation,
      proxy: artifactRecord(artifacts.proxy, proxyRuntime),
    },
    steps: [
      { id: "deploy-context-registry", nonce: nonce.toString(), to: null, value: "0", data: contextData },
      { id: "deploy-hub-proxy", nonce: (nonce + 1n).toString(), to: null, value: "0", data: proxyData },
    ],
    followUp: {
      unsignedNftMinterGrants,
      contextRegistrationTemplate: {
        status: "UNSIGNED_NOT_EXECUTED",
        registrar: config.roles.governanceAdmin,
        target: contextRegistry,
        operations: [
          { signature: "registerCreator(bytes32,string)", args: ["CREATOR_ID", "PUBLIC_SLUG"] },
          { signature: "registerCampaign(bytes32,bytes32,string)", args: ["CAMPAIGN_ID", "CREATOR_ID", "PUBLIC_SLUG"], authority: addresses.timelock },
        ],
      },
    },
    safety: {
      deploysReplacementNfts: false,
      deploysReplacementTimelock: false,
      deploysReplacementCodec: false,
      deploysReplacementImplementation: false,
      automaticallyGrantsNftRoles: false,
      automaticallyRegistersContexts: false,
      createsGovernanceBootstrapAdmin: false,
    },
  };
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${json(value)}\n`, { mode: 0o644 });
  await rename(temporary, path);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("arguments must be --name value pairs");
    args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.startNonce || !args.planOut || !args.configOut) {
    throw new Error("--manifest, --start-nonce, --plan-out, and --config-out are required");
  }
  const manifest = JSON.parse(await readFile(resolve(args.manifest), "utf8"));
  const artifacts = await loadReplacementArtifacts(process.cwd());
  const config = createReplacementExecutionConfig(manifest, args.rpcUrl);
  const plan = buildReplacementPlan(manifest, config, BigInt(args.startNonce), artifacts);
  await atomicWrite(resolve(args.configOut), serializeReplacementConfig(config));
  await atomicWrite(resolve(args.planOut), plan);
  process.stdout.write(`CONFIG_WRITTEN ${resolve(args.configOut)}\n`);
  process.stdout.write(`PLAN_WRITTEN ${resolve(args.planOut)}\n`);
  process.stdout.write(`PLAN_HASH ${sha256(json(plan))}\n`);
  process.stdout.write("MODE PLAN_ONLY (no RPC call, signature, or broadcast)\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`ERROR ${error.message}\n`);
    process.exitCode = 1;
  });
}
