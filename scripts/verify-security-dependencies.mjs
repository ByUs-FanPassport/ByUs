import { readFile } from "node:fs/promises";

const rootManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const workerManifest = JSON.parse(
  await readFile(new URL("../apps/worker/package.json", import.meta.url), "utf8"),
);
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));

function versionTuple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`unsupported version: ${version}`);
  return match.slice(1).map(Number);
}

function isBefore(version, minimum) {
  const current = versionTuple(version);
  const required = versionTuple(minimum);
  return current.some((part, index) => part !== required[index]
    && part < required[index]
    && current.slice(0, index).every((value, prior) => value === required[prior]));
}

const failures = [];
const packages = Object.entries(lock.packages ?? {});

if (process.versions.node.split(".")[0] !== "24") {
  failures.push(`security verification requires Node 24, received ${process.versions.node}`);
}

if (workerManifest.dependencies?.["@aws-sdk/client-secrets-manager"] !== "3.1091.0") {
  failures.push("@aws-sdk/client-secrets-manager must remain pinned to 3.1091.0");
}

if (packages.some(([path]) => path === "node_modules/fast-xml-parser"
  || path.endsWith("/node_modules/fast-xml-parser"))) {
  failures.push("fast-xml-parser must not be present in the dependency tree");
}

for (const [path, metadata] of packages) {
  if (path === "node_modules/axios" || path.endsWith("/node_modules/axios")) {
    if (isBefore(metadata.version, "1.18.1")) {
      failures.push(`${path} resolved to vulnerable axios ${metadata.version}`);
    }
  }

  if (path === "node_modules/ws" || path.endsWith("/node_modules/ws")) {
    const [major] = versionTuple(metadata.version);
    if (major === 8 && isBefore(metadata.version, "8.21.0")) {
      failures.push(`${path} resolved to vulnerable ws ${metadata.version}`);
    }
  }
}

const axiosOverride = rootManifest.overrides?.["@coinbase/cdp-sdk"]?.axios;
if (axiosOverride !== "1.18.1") {
  failures.push("Coinbase CDP axios override must remain pinned to 1.18.1");
}

if (rootManifest.overrides?.["ws@>=8.0.0 <8.21.0"] !== "8.21.1") {
  failures.push("vulnerable ws 8.x override must remain pinned to 8.21.1");
}

if (failures.length > 0) {
  throw new Error(`security dependency verification failed:\n- ${failures.join("\n- ")}`);
}

console.log("Security dependency verification passed: AWS XML, Axios, and ws constraints are safe.");
