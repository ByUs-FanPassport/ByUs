import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const kyaaAssetKeys = ["passport", "knowledge", "reservation", "attendance", "survey", "membership", "reaction", "mission",
  "welcome", "first_comment", "subscription", "support", "share", "invite", "daily_checkin"].sort();

export async function readKyaaAssetBundle(root) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.version !== 2 || !Array.isArray(manifest.assets)
    || JSON.stringify(manifest.assets.map((asset) => asset.key).sort()) !== JSON.stringify(kyaaAssetKeys)) {
    throw new Error("Incomplete kyaa asset coverage");
  }
  if (manifest.assets.some((asset) => asset.file !== `${asset.key}.png`)) throw new Error("Invalid kyaa asset path");
  const files = [];
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(root, asset.file));
    if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256
      || bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.readUInt32BE(16) !== asset.width || bytes.readUInt32BE(20) !== asset.height
      || asset.width !== asset.height || asset.width < 1024 || bytes[25] !== 6) {
      throw new Error(`Kyaa asset integrity failed: ${asset.key}`);
    }
    files.push({ name: asset.file, bytes });
  }
  files.push({ name: "manifest.json", bytes: manifestBytes });
  return files;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat().sort();
}

async function main() {
  const environment = process.argv[2];
  const kyaa = process.argv[3] === "kyaa-v2";
  if (!new Set(["dev", "prod"]).has(environment) || (process.argv[3] && !kyaa) || process.argv.length > 4) {
    throw new Error("Usage: node scripts/pin-metadata-assets.mjs <dev|prod> [kyaa-v2]");
  }
  const jwtName = environment === "dev" ? "PINATA_DEV_JWT" : "PINATA_PROD_JWT";
  const jwt = process.env[jwtName];
  if (!jwt) throw new Error(`${jwtName} is required`);
  const root = resolve(kyaa ? "apps/worker/assets/kyaa-credentials-v2" : "artifacts/metadata-assets");
  const files = kyaa ? await readKyaaAssetBundle(root) : await Promise.all((await filesUnder(root)).map(async (path) => ({
    name: relative(root, path).split(sep).join("/"), bytes: await readFile(path),
  })));
  const form = new FormData();
  for (const file of files) form.append("file", new Blob([file.bytes]), kyaa ? `credentials/v2/${file.name}` : file.name);
  form.append("pinataMetadata", JSON.stringify({ name: `${kyaa ? "kyaa-credential-assets-v2" : "byus-credential-assets-v1"}-${environment}` }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }));

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.IpfsHash !== "string") {
    const message = typeof body.error === "string"
      ? body.error
      : typeof body.error?.details === "string"
        ? body.error.details
        : typeof body.message === "string"
          ? body.message
          : "No error details returned";
    throw new Error(`Pinata ${environment} pin failed with HTTP ${response.status}: ${message}`);
  }
  process.stdout.write(`${JSON.stringify({ environment, cid: body.IpfsHash, fileCount: files.length })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
