import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, http, keccak256, padHex, stringToHex, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildCanonicalActionPayload } from "../src/action-builder.js";
import { actionCodes, type ActionSourceSnapshotV1, type FanActionJob } from "../src/action-domain.js";
import { actionHubAbi, ViemActionHubAdapter } from "../src/adapters/viem-action-hub.js";
import { ViemActionLogReader } from "../src/action-chain-reader.js";
import { aggregateFanActionMetrics } from "../src/action-metrics.js";

const enabled = process.env.RUN_ACTION_ANVIL_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const contractsDir = resolve(process.cwd(), "../../contracts");
const privateKeys = [
  `0x${"ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"}`,
  `0x${"2".repeat(64)}`,
  `0x${"3".repeat(64)}`,
  `0x${"4".repeat(64)}`,
] as const;

async function artifact(path: string) {
  return JSON.parse(await readFile(resolve(contractsDir, "out", path), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
}

suite("ActionWorker to ActionHub local Anvil", () => {
  const port = 20_000 + (process.pid % 10_000);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chainDefinition = defineChain({ id: 91342, name: "Local GIWA", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  let anvil: ChildProcess;
  let publicClient: any;
  let wallet: any;
  const account = privateKeyToAccount(privateKeys[0]);

  beforeAll(async () => {
    execFileSync("forge", ["build"], { cwd: contractsDir, stdio: "pipe" });
    // MockEAS is an integration-only source and can be omitted by an incremental production build.
    execFileSync("forge", ["build", "src/mocks/MockEAS.sol"], { cwd: contractsDir, stdio: "pipe" });
    anvil = spawn("anvil", ["--silent", "--port", String(port), "--chain-id", "91342"], { stdio: "pipe" });
    publicClient = createPublicClient({ chain: chainDefinition, transport: http(rpcUrl) });
    wallet = createWalletClient({ chain: chainDefinition, account, transport: http(rpcUrl) });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { await publicClient.getChainId(); return; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 50)); }
    }
    throw new Error("Anvil did not start");
  }, 60_000);
  afterAll(() => anvil?.kill("SIGTERM"));

  it("mints Passport and Knowledge Stamp, attests once, validates the receipt, and reconciles idempotently", async () => {
    const deploy = async (artifactPath: string, args: readonly unknown[] = []): Promise<Address> => {
      const contract = await artifact(artifactPath);
      const hash = await wallet.deployContract({ abi: contract.abi, bytecode: contract.bytecode.object, args, account });
      return (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    const easArtifact = await artifact("MockEAS.sol/MockEAS.json");
    const eas = await deploy("MockEAS.sol/MockEAS.json");
    const passportArtifact = await artifact("ByUsPassport.sol/ByUsPassport.json");
    const stampArtifact = await artifact("ByUsStamp.sol/ByUsStamp.json");
    const passport = await deploy("ByUsPassport.sol/ByUsPassport.json", [account.address, account.address]);
    const stamp = await deploy("ByUsStamp.sol/ByUsStamp.json", [account.address, account.address]);
    const collectible = await deploy("ByUsCollectible.sol/ByUsCollectible.json", [account.address, account.address]);
    const codec = await deploy("ByUsActionCodec.sol/ByUsActionCodec.json");
    const timelock = await deploy("TimelockController.sol/TimelockController.json", [172800n, [account.address], [account.address], `0x${"0".repeat(40)}`]);
    const contextRegistry = await deploy("ByUsPublicContextRegistry.sol/ByUsPublicContextRegistry.json", [timelock]);
    const implementation = await deploy("ByUsActionHub.sol/ByUsActionHub.json");
    const hubArtifact = await artifact("ByUsActionHub.sol/ByUsActionHub.json");
    const environmentId = keccak256(stringToHex("GIWA_SEPOLIA_DEV"));
    const schemaUid = keccak256(stringToHex("BYUS_ACTION_V1"));
    const initData = encodeFunctionData({ abi: hubArtifact.abi, functionName: "initialize", args: [{ admin: timelock, writer: account.address, migrator: privateKeyToAccount(privateKeys[1]).address, corrector: privateKeyToAccount(privateKeys[2]).address, pauser: privateKeyToAccount(privateKeys[3]).address, easAddress: eas, environmentId, schemaUID: schemaUid, passport, stamp, collectible, codec, contextRegistry }] });
    const hub = await deploy("ERC1967Proxy.sol/ERC1967Proxy.json", [implementation, initData]);
    const minterRole = keccak256(stringToHex("MINTER_ROLE"));
    for (const [target, abi] of [[passport, passportArtifact.abi], [stamp, stampArtifact.abi]] as const) {
      const hash = await wallet.writeContract({ address: target, abi, functionName: "grantRole", args: [minterRole, hub], account });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    const creatorId = keccak256(stringToHex("creator"));
    const registryArtifact = await artifact("ByUsPublicContextRegistry.sol/ByUsPublicContextRegistry.json");
    const timelockArtifact = await artifact("TimelockController.sol/TimelockController.json");
    const creatorCall = encodeFunctionData({ abi: registryArtifact.abi, functionName: "registerCreator", args: [creatorId, "kara"] });
    const predecessor = `0x${"0".repeat(64)}`; const salt = keccak256(stringToHex("register-kara"));
    let hash = await wallet.writeContract({ address: timelock, abi: timelockArtifact.abi, functionName: "schedule", args: [contextRegistry, 0n, creatorCall, predecessor, salt, 172800n], account });
    await publicClient.waitForTransactionReceipt({ hash });
    await publicClient.request({ method: "evm_increaseTime", params: [172801] } as any);
    await publicClient.request({ method: "evm_mine", params: [] } as any);
    hash = await wallet.writeContract({ address: timelock, abi: timelockArtifact.abi, functionName: "execute", args: [contextRegistry, 0n, creatorCall, predecessor, salt], account });
    await publicClient.waitForTransactionReceipt({ hash });
    const chain = new ViemActionHubAdapter({ rpcUrl, chainId: 91342, privateKey: privateKeys[0], hubAddress: hub, deploymentBlock: 0n, client: publicClient, feePolicy: { maxGas: 5_000_000n, maxFeePerGasWei: 10_000_000_000n, maxPriorityFeePerGasWei: 10_000_000_000n, maxExecutionFeeWei: 50_000_000_000_000_000n } });
    const snapshot: ActionSourceSnapshotV1 = {
      version: 1, chainId: 91342, environmentId, hubProxy: hub, schemaUid, schemaVersion: 1, bindingVersion: 1,
      operationKind: "RECORD_AND_ISSUE", sourceNamespace: "quiz_passes", canonicalSourceKey: "anvil-quiz-1", revision: 1,
      actionCode: actionCodes.FAN_VERIFIED, policyVersion: 1, recipient: privateKeyToAccount(privateKeys[3]).address,
      creatorId, campaignId: `0x${"0".repeat(64)}`, sourceOccurredAt: new Date().toISOString(),
      origin: "NATIVE", evidenceCommitment: keccak256(stringToHex("evidence")), migrationBatchId: `0x${"0".repeat(64)}`,
      assetBaseUri: "ipfs://bafyassets/v1", migrationProof: [], credentials: [
        { kind: 0, nftContract: passport, issuanceKey: keccak256(stringToHex("passport")), mode: "MINT", metadata: { operationKey: "passport:anvil", legacyEntityType: "passport", legacyPayload: { recipient: privateKeyToAccount(privateKeys[3]).address, celebritySlug: "kara", passportId: keccak256(stringToHex("passport")) } } },
        { kind: 1, nftContract: stamp, issuanceKey: keccak256(stringToHex("knowledge")), mode: "MINT", metadata: { operationKey: "knowledge:anvil", legacyEntityType: "stamp", legacyPayload: { recipient: privateKeyToAccount(privateKeys[3]).address, celebritySlug: "kara", issuanceId: keccak256(stringToHex("knowledge")), stampType: "Knowledge" } } },
      ],
    };
    const job: FanActionJob = { id: "82479946-5c2b-4cb7-838a-cd48f260bbcf", occurrenceRowId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c", payloadVersion: 1, sourceSnapshot: snapshot, payload: null, actionId: null, requestHash: null, attempts: 1, maxAttempts: 8, txHash: null, signedTransaction: null, leaseOwner: "anvil", leaseExpiresAt: "2099-01-01T00:00:00Z" };
    const payload = await buildCanonicalActionPayload(job, snapshot, { pin: async (_document, operationKey) => `ipfs://${operationKey}` }, chain);
    const currentFeeCap = new ViemActionHubAdapter({ rpcUrl, chainId: 91342, privateKey: privateKeys[0], hubAddress: hub, deploymentBlock: 0n, client: publicClient });
    await expect(currentFeeCap.prepare(payload)).rejects.toMatchObject({ code: "MINT_FEE_POLICY_BLOCKED" });
    const submission = await chain.prepare(payload);
    expect(await chain.broadcast(submission.signedTransaction)).toBe(submission.txHash);
    const receipt = await chain.receipt(payload, submission);
    expect(receipt?.credentials).toHaveLength(2);
    expect(new Set(receipt?.credentials.map((item) => item.kind))).toEqual(new Set([0, 1]));
    await expect(chain.findExisting(payload)).resolves.toMatchObject({ txHash: submission.txHash, easUid: receipt?.easUid });
    const indexed = await new ViemActionLogReader({ rpcUrl, chainId: 91342, hubAddress: hub, fromBlock: 0n, client: publicClient }).read(environmentId);
    expect(indexed).toHaveLength(1);
    expect(indexed[0]).toMatchObject({ actionCode: 1, status: "ACTIVE" });
    expect(new Set(indexed[0]?.credentials.map((item) => item.kind))).toEqual(new Set([0, 1]));
    const boundary = { chainId: 91342, environmentId, hubProxy: hub, schemaUid, asOfEpochSeconds: BigInt(Math.floor(Date.now() / 1000)) };
    expect(aggregateFanActionMetrics(indexed, boundary).transactions).toBe(0);
    expect(aggregateFanActionMetrics(indexed.map((item) => ({ ...item, finality: "finalized" as const })), boundary, { includeHistorical: false })).toMatchObject({ actionCounts: { 1: 1 }, passportCredentials: 1, mintedCredentials: 2, transactions: 1 });

    const wrappedClient = (overrides: {
      receiptLogs?: (logs: readonly any[]) => readonly any[];
      attestation?: (value: any) => any;
    }): PublicClient => new Proxy(publicClient as PublicClient, {
      get(target, property, receiver) {
        if (property === "getTransactionReceipt" && overrides.receiptLogs) {
          return async (args: any) => {
            const current = await target.getTransactionReceipt(args);
            return { ...current, logs: overrides.receiptLogs!(current.logs) };
          };
        }
        if (property === "readContract" && overrides.attestation) {
          return async (args: any) => {
            const current = await target.readContract(args);
            return args.functionName === "getAttestation" ? overrides.attestation!(current) : current;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const receiptAdapter = (client: PublicClient) => new ViemActionHubAdapter({ rpcUrl, chainId: 91342, privateKey: privateKeys[0], hubAddress: hub, deploymentBlock: 0n, client, feePolicy: { maxGas: 5_000_000n, maxFeePerGasWei: 10_000_000_000n, maxPriorityFeePerGasWei: 10_000_000_000n, maxExecutionFeeWei: 50_000_000_000_000_000n } });
    const withoutCredential = wrappedClient({ receiptLogs: (logs) => {
      let removed = false;
      return logs.filter((log) => {
        if (removed || String(log.address).toLowerCase() !== hub.toLowerCase()) return true;
        try {
          if (decodeEventLog({ abi: actionHubAbi, data: log.data, topics: log.topics }).eventName === "CredentialLinked") {
            removed = true;
            return false;
          }
        } catch { /* unrelated log */ }
        return true;
      });
    } });
    await expect(receiptAdapter(withoutCredential).receipt(payload, submission)).rejects.toMatchObject({ code: "ACTION_CREDENTIAL_COUNT_MISMATCH" });

    const wrongProxy = wrappedClient({ receiptLogs: (logs) => logs.map((log) => String(log.address).toLowerCase() === hub.toLowerCase() ? { ...log, address: account.address } : log) });
    await expect(receiptAdapter(wrongProxy).receipt(payload, submission)).rejects.toMatchObject({ code: "ACTION_EVENT_NOT_FOUND" });

    const wrongNft = wrappedClient({ receiptLogs: (logs) => {
      let changed = false;
      return logs.map((log) => {
        if (changed || String(log.address).toLowerCase() !== hub.toLowerCase()) return log;
        try {
          if (decodeEventLog({ abi: actionHubAbi, data: log.data, topics: log.topics }).eventName === "CredentialLinked") {
            changed = true;
            const topics = [...log.topics];
            topics[2] = padHex(account.address, { size: 32 });
            return { ...log, topics };
          }
        } catch { /* unrelated log */ }
        return log;
      });
    } });
    await expect(receiptAdapter(wrongNft).receipt(payload, submission)).rejects.toMatchObject({ code: "ACTION_CREDENTIAL_MISMATCH" });

    for (const field of ["schema", "attester"] as const) {
      const corruptEas = wrappedClient({ attestation: (value) => ({ ...value, [field]: field === "schema" ? keccak256(stringToHex("WRONG_SCHEMA")) : account.address }) });
      await expect(receiptAdapter(corruptEas).receipt(payload, submission)).rejects.toMatchObject({ code: "EAS_ATTESTATION_MISMATCH" });
    }

    hash = await wallet.writeContract({ address: eas, abi: easArtifact.abi, functionName: "forceRecipient", args: [receipt!.easUid, account.address], account });
    await publicClient.waitForTransactionReceipt({ hash });
    await expect(chain.receipt(payload, submission)).rejects.toMatchObject({ code: "EAS_ATTESTATION_MISMATCH" });
    await expect(new ViemActionLogReader({ rpcUrl, chainId: 91342, hubAddress: hub, fromBlock: 0n, client: publicClient }).read(environmentId)).rejects.toThrow("EAS record mismatch");
  }, 60_000);
});
