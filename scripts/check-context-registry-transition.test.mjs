import assert from "node:assert/strict";
import test from "node:test";
import { scanLogs } from "./check-context-registry-transition.mjs";

const address = `0x${"12".repeat(20)}`;
test("scans every block including the registry deployment block", async () => {
  const ranges = [];
  const logs = await scanLogs({ getLogs: async (args) => { ranges.push([args.fromBlock, args.toBlock]); return []; } }, address, 12n, 2012n);
  assert.deepEqual(ranges, [[12n, 1011n], [1012n, 2011n], [2012n, 2012n]]);
  assert.deepEqual(logs, []);
});
test("does not suppress registration events in the deployment block", async () => {
  const log = { address, blockNumber: 12n, removed: false };
  assert.deepEqual(await scanLogs({ getLogs: async () => [log] }, address, 12n, 12n), [log]);
});
test("fails closed on RPC failure, missing response and incomplete ranges", async () => {
  await assert.rejects(scanLogs({ getLogs: async () => { throw Error("RPC unavailable"); } }, address, 0n, 10n), /RPC unavailable/);
  await assert.rejects(scanLogs({ getLogs: async () => undefined }, address, 0n, 10n), /Incomplete RPC/);
  await assert.rejects(scanLogs({}, address, 12n, 11n), /incomplete block range/);
  for (const log of [{ address, blockNumber: 20n }, { address, blockNumber: null }, { address, blockNumber: 2n, removed: true }, { address: `0x${"34".repeat(20)}`, blockNumber: 2n }]) {
    await assert.rejects(scanLogs({ getLogs: async () => [log] }, address, 0n, 10n), /Untrusted RPC/);
  }
});

const { checkTransition } = await import("./check-context-registry-transition.mjs");
const { keccak256 } = await import("viem");
const lock = `0x${"34".repeat(20)}`;
const proxy = `0x${"56".repeat(20)}`;
function fixture(options = {}) {
  const manifest = {
    chainId: 91342,
    addresses: { contextRegistry: address, timelock: lock, hubProxy: proxy },
    transactions: [{ id: "deploy-context-registry", txHash: "0xdeploy", blockNumber: "12" }, { id: "deploy-timelock", blockNumber: "10" }],
    artifacts: { contextRegistry: { expectedRuntimeCodeHash: keccak256("0x6000") } },
  };
  const client = {
    getChainId: async () => 91342,
    getTransactionReceipt: async () => ({ status: "success", contractAddress: address, blockNumber: 12n, blockHash: "0x12" }),
    getBlock: async ({ blockTag, blockNumber }) => ({ number: blockTag === "finalized" ? 30n : blockNumber ?? 31n, hash: blockNumber === 12n ? "0x12" : "0x31" }),
    getCode: async () => "0x6000",
    getLogs: async ({ address: target }) => target === address ? options.registryLogs ?? [] : options.schedules ?? [],
    getStorageAt: async () => `0x${"00".repeat(12)}${address.slice(2)}`,
    readContract: async ({ functionName, args }) => {
      if (functionName === "admin") return lock;
      if (functionName === "getMinDelay") return 172800n;
      if (functionName === "getTimestamp") return 2000000000n;
      if (functionName === "hasRole") return args[1] !== `0x${"00".repeat(20)}`;
      throw Error("Unexpected read");
    },
    ...options.client,
  };
  return { client, manifest };
}

test("empty finalized registry and unchanged governance pass without chain writes", async () => {
  const { client, manifest } = fixture();
  assert.equal((await checkTransition(client, manifest)).status, "READ_ONLY_PREFLIGHT_PASS");
});
test("any legacy registration, including an inactive historical ID, blocks the transition", async () => {
  const { client, manifest } = fixture({ registryLogs: [{ address, blockNumber: 12n }] });
  await assert.rejects(checkTransition(client, manifest), /not empty/);
});
test("only the exact reviewed pending operation is allowed", async () => {
  const id = `0x${"ab".repeat(32)}`;
  const { client, manifest } = fixture({ schedules: [{ address: lock, blockNumber: 20n, args: { id } }] });
  await assert.rejects(checkTransition(client, manifest), /Other pending/);
  assert.equal((await checkTransition(client, manifest, id)).status, "READ_ONLY_PREFLIGHT_PASS");
});
test("receipt, RPC, delay, code and pointer changes fail closed", async () => {
  for (const override of [
    { getChainId: async () => 1 },
    { getTransactionReceipt: async () => ({ status: "reverted" }) },
    { getLogs: async () => { throw Error("RPC failed"); } },
    { getCode: async () => "0x6001" },
    { getStorageAt: async () => `0x${"00".repeat(32)}` },
    { readContract: async ({ functionName }) => functionName === "admin" ? lock : 0n },
  ]) {
    const { client, manifest } = fixture({ client: override });
    await assert.rejects(checkTransition(client, manifest));
  }
});

test("paused Hub keeps registry address in the low 20 bytes of slot 7", async () => {
  const { client, manifest } = fixture({ client: { getStorageAt: async () => `0x${"00".repeat(11)}01${address.slice(2)}` } });
  assert.equal((await checkTransition(client, manifest)).status, "READ_ONLY_PREFLIGHT_PASS");
});
test("unfinalized deployment, wrong deployment block and preflight reorg fail closed", async () => {
  const base = fixture().client;
  for (const override of [
    { getTransactionReceipt: async () => ({ ...await base.getTransactionReceipt(), blockNumber: 13n }) },
    { getBlock: async (args) => args.blockTag === "finalized" ? { number: 11n } : base.getBlock(args) },
    { getBlock: async (args) => args.blockNumber === 31n ? { number: 31n, hash: "0xchanged" } : base.getBlock(args) },
    { readContract: async (args) => args.functionName === "admin" ? proxy : base.readContract(args) },
  ]) {
    const { client, manifest } = fixture({ client: override });
    await assert.rejects(checkTransition(client, manifest));
  }
});
