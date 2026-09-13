import "server-only";
import { unstable_cache } from "next/cache";
import { readFinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { onchainConfig } from "./public-config";
import { projectPublicOnchainSnapshot } from "./public-aggregate";
import type { PublicOnchainResult, PublicOnchainSnapshot } from "./public-types";

// Bump this namespace whenever verification or exclusion rules change; Next persists the cache across deployments.
let pending: Promise<PublicOnchainSnapshot> | undefined;
const readSnapshot = unstable_cache(async () => {
  pending ??= readFinalizedActionSnapshot(onchainConfig).then((snapshot) => projectPublicOnchainSnapshot(snapshot)).finally(() => { pending = undefined; });
  return pending;
}, ["byus-public-onchain-v2-finality-provenance", onchainConfig.hubAddress, onchainConfig.environmentId, ...onchainConfig.qaWallets], { revalidate: 300 });

export async function getPublicOnchainResult(): Promise<PublicOnchainResult> {
  try {
    const snapshot = await readSnapshot();
    // A stale cached success must not silently masquerade as a current reading.
    if (Date.now() - Date.parse(snapshot.generatedAt) > 15 * 60 * 1000) return { state: "unavailable" };
    return { state: "available", snapshot };
  } catch {
    // No RPC endpoint, request payload, or infrastructure error escapes publicly.
    return { state: "unavailable" };
  }
}
