import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const environment = process.argv[2];
if (!new Set(["dev", "prod"]).has(environment)) {
  throw new Error("Usage: node scripts/pin-metadata-assets.mjs <dev|prod>");
}

const jwtName = environment === "dev" ? "PINATA_DEV_JWT" : "PINATA_PROD_JWT";
const jwt = process.env[jwtName];
if (!jwt) throw new Error(`${jwtName} is required`);

const root = resolve("artifacts/metadata-assets");

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat().sort();
}

const files = await filesUnder(root);
const form = new FormData();
for (const path of files) {
  const filename = relative(root, path).split(sep).join("/");
  form.append("file", new Blob([await readFile(path)]), filename);
}
form.append("pinataMetadata", JSON.stringify({ name: `byus-credential-assets-v1-${environment}` }));
form.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }));

const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}` },
  body: form,
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
