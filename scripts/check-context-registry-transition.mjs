#!/usr/bin/env node
// Read-only gate. Run immediately before BOTH scheduling and executing the upgrade.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, keccak256, parseAbi, parseAbiItem, toHex } from "viem";

const HUB_CONTEXT_SLOT = toHex(0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700n + 7n, { size: 32 });
const ADMIN = "0xeee82f960476c888950c798c444c1fd92cbbfe50";
const ABI = parseAbi([
  "function admin() view returns (address)",
  "function getMinDelay() view returns (uint256)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
]);
const SCHEDULED = parseAbiItem("event CallScheduled(bytes32 indexed id,uint256 indexed index,address target,uint256 value,bytes data,bytes32 predecessor,uint256 delay)");
const role = (name) => keccak256(new TextEncoder().encode(name));

export async function scanLogs(client, address, fromBlock, toBlock, event) {
  if (fromBlock < 0n || toBlock < fromBlock) throw Error("Invalid or incomplete block range");
  const result = [];
  for (let from = fromBlock; from <= toBlock; from += 1000n) {
    const end = from + 999n < toBlock ? from + 999n : toBlock;
    const logs = await client.getLogs({ address, fromBlock: from, toBlock: end, ...(event ? { event, strict: true } : {}) });
    if (!Array.isArray(logs)) throw Error("Incomplete RPC log response");
    for (const log of logs) {
      if (log.removed || typeof log.blockNumber !== "bigint" || log.blockNumber < from
        || log.blockNumber > end || log.address.toLowerCase() !== address.toLowerCase()) {
        throw Error("Untrusted RPC log range or address");
      }
    }
    result.push(...logs);
  }
  return result;
}

export async function checkTransition(client, manifest, allowedOperation) {
  if (await client.getChainId() !== 91342 || manifest.chainId !== 91342) throw Error("Wrong chain");
  const { contextRegistry, timelock, hubProxy } = manifest.addresses;
  const deployment = manifest.transactions.find((tx) => tx.id === "deploy-context-registry");
  const lockDeployment = manifest.transactions.find((tx) => tx.id === "deploy-timelock");
  if (!deployment || !lockDeployment) throw Error("Deployment evidence missing");
  const receipt = await client.getTransactionReceipt({ hash: deployment.txHash });
  if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== contextRegistry.toLowerCase()
    || receipt.blockNumber !== BigInt(deployment.blockNumber)) throw Error("Wrong registry deployment receipt");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const head = await client.getBlock({ blockTag: "latest" });
  if (finalized.number < receipt.blockNumber) throw Error("Registry deployment not finalized");
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash !== receipt.blockHash) throw Error("Registry deployment reorged");
  const code = await client.getCode({ address: contextRegistry, blockNumber: head.number });
  if (!code || keccak256(code) !== manifest.artifacts.contextRegistry.expectedRuntimeCodeHash) throw Error("Registry runtime mismatch");
  const logs = await scanLogs(client, contextRegistry, receipt.blockNumber, head.number);
  if (logs.length) throw Error("Legacy registry is not empty; explicit context migration is required");
  const read = (address, functionName, args) => client.readContract({ address, abi: ABI, functionName, args, blockNumber: head.number });
  if ((await read(contextRegistry, "admin")).toLowerCase() !== timelock.toLowerCase()) throw Error("Wrong registry governance");
  if (await read(timelock, "getMinDelay") !== 172800n) throw Error("Timelock delay changed");
  const raw = await client.getStorageAt({ address: hubProxy, slot: HUB_CONTEXT_SLOT, blockNumber: head.number });
  // Registry and the paused bool share slot 7. The address occupies the low 20 bytes.
  if (!raw || `0x${raw.slice(-40)}`.toLowerCase() !== contextRegistry.toLowerCase()) throw Error("Hub context pointer changed");
  for (const name of ["PROPOSER_ROLE", "EXECUTOR_ROLE"]) {
    if (!await read(timelock, "hasRole", [role(name), ADMIN])) throw Error("Admin governance role missing");
  }
  if (await read(timelock, "hasRole", [role("EXECUTOR_ROLE"), `0x${"00".repeat(20)}`])) throw Error("Open executor is not permitted");
  const schedules = await scanLogs(client, timelock, BigInt(lockDeployment.blockNumber), head.number, SCHEDULED);
  for (const id of new Set(schedules.map((log) => log.args.id))) {
    if (!id) throw Error("Incomplete scheduled operation decode");
    const timestamp = await read(timelock, "getTimestamp", [id]);
    if (timestamp > 1n && id.toLowerCase() !== allowedOperation?.toLowerCase()) throw Error(`Other pending timelock operation: ${id}`);
  }
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) throw Error("Preflight block reorged");
  return { status: "READ_ONLY_PREFLIGHT_PASS", blockNumber: head.number.toString(), blockHash: head.hash,
    registry: contextRegistry, registryRegistrationLogs: 0, delaySeconds: 172800,
    limitation: "Operational empty-registry check, not an atomic onchain guarantee. Re-run before scheduling and execution; do not execute legacy registrations during the transition." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [manifestPath, allowedOperation] = process.argv.slice(2);
    if (!manifestPath) throw Error("Usage: node scripts/check-context-registry-transition.mjs <manifest.json> [allowed-upgrade-operation-id]");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const client = createPublicClient({ transport: http("https://sepolia-rpc.giwa.io", { retryCount: 0, timeout: 15000 }) });
    console.log(JSON.stringify(await checkTransition(client, manifest, allowedOperation), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
