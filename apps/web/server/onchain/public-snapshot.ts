import "server-only";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { unstable_cache } from "next/cache";
import { readFinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { onchainConfig } from "./public-config";
import { projectPublicOnchainSnapshot } from "./public-aggregate";
import type { PublicOnchainResult, PublicOnchainSnapshot } from "./public-types";

// Bump this namespace whenever verification or exclusion rules change; Next persists the cache across deployments.
const readConfig = { ...onchainConfig, rpcUrl: process.env.GIWA_PUBLIC_READ_RPC_URL?.trim() || onchainConfig.rpcUrl };
const compress = promisify(gzip);
const decompress = promisify(gunzip);
let pending: Promise<string> | undefined;
const readSnapshot = unstable_cache(async () => {
  pending ??= readFinalizedActionSnapshot(readConfig).then(async (source) => {
    // Keep the complete ledger within the platform's cache entry size limit.
    return (await compress(JSON.stringify(projectPublicOnchainSnapshot(source)))).toString("base64");
  }).finally(() => { pending = undefined; });
  return pending;
}, [
  "byus-public-onchain-v5-compressed-binding-provenance",
  createHash("sha256").update(readConfig.rpcUrl).digest("hex"),
  ...onchainConfig.deployments.flatMap(({ hubAddress, fromBlock, label, writeStatus }) => [hubAddress, fromBlock.toString(), label, writeStatus]),
  onchainConfig.environmentId,
  onchainConfig.schemaUid,
  onchainConfig.easAddress,
  ...Object.entries(onchainConfig.assetBindings).flatMap(([version, assets]) => [version, ...Object.entries(assets).flatMap(([kind, address]) => [kind, address])]),
  ...onchainConfig.qaWallets,
], { revalidate: 600 });

export async function getPublicOnchainResult(): Promise<PublicOnchainResult> {
  try {
    const snapshot = JSON.parse((await decompress(Buffer.from(await readSnapshot(), "base64"))).toString()) as PublicOnchainSnapshot;
    // A stale cached success must not silently masquerade as a current reading.
    if (Date.now() - Date.parse(snapshot.generatedAt) > 15 * 60 * 1000) return { state: "unavailable" };
    return { state: "available", snapshot };
  } catch {
    // No RPC endpoint, request payload, or infrastructure error escapes publicly.
    return { state: "unavailable" };
  }
}
