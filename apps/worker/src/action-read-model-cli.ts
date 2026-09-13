import { z } from "zod";
import { ViemActionLogReader } from "./action-chain-reader.js";
import { aggregateFanActionMetrics } from "./action-metrics.js";

const pairs = process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") && all[index + 1] && !all[index + 1]!.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []);
const args = Object.fromEntries(pairs);
const input = z.object({ rpc: z.string().url(), hub: z.string().regex(/^0x[0-9a-fA-F]{40}$/), "from-block": z.coerce.bigint().nonnegative(), schema: z.string().regex(/^0x[0-9a-fA-F]{64}$/), environment: z.string().regex(/^0x[0-9a-fA-F]{64}$/), "chain-id": z.coerce.number().int().positive() }).parse(args);
const reader = new ViemActionLogReader({ rpcUrl: input.rpc, chainId: input["chain-id"], hubAddress: input.hub as `0x${string}`, fromBlock: input["from-block"] });
const actions = await reader.read(input.environment as `0x${string}`);
const metrics = aggregateFanActionMetrics(actions, { chainId: input["chain-id"], hubProxy: input.hub, schemaUid: input.schema, environmentId: input.environment, asOfEpochSeconds: BigInt(Math.floor(Date.now() / 1000)) }, { includeHistorical: process.argv.includes("--include-historical") });
process.stdout.write(`${JSON.stringify({ actions, metrics }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
