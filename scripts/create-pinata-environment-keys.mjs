import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const envPath = resolve(".env.pinata.local");
const nextPath = `${envPath}.next`;
const source = await readFile(envPath, "utf8");
const values = Object.fromEntries(
  source.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split), line.slice(split + 1)];
  }),
);

for (const environment of ["DEV", "PROD"]) {
  const existingJwt = values[`PINATA_${environment}_JWT`];
  if (!existingJwt) throw new Error(`PINATA_${environment}_JWT is required`);
  const response = await fetch("https://api.pinata.cloud/users/generateApiKey", {
    method: "POST",
    headers: {
      authorization: `Bearer ${existingJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      keyName: `byus-metadata-${environment.toLowerCase()}-20260721`,
      permissions: {
        admin: false,
        endpoints: {
          data: { pinList: true },
          pinning: { pinFileToIPFS: true, pinJSONToIPFS: true },
        },
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.JWT || !body.pinata_api_key || !body.pinata_api_secret) {
    throw new Error(`Pinata ${environment.toLowerCase()} key creation failed with HTTP ${response.status}`);
  }
  values[`PINATA_${environment}_JWT`] = body.JWT;
  values[`PINATA_${environment}_API_KEY`] = body.pinata_api_key;
  values[`PINATA_${environment}_API_SECRET`] = body.pinata_api_secret;
}

const order = [
  "PINATA_DEV_JWT",
  "PINATA_DEV_API_KEY",
  "PINATA_DEV_API_SECRET",
  "PINATA_GATEWAY_URL",
  "PINATA_PROD_JWT",
  "PINATA_PROD_API_KEY",
  "PINATA_PROD_API_SECRET",
];
await writeFile(nextPath, `${order.map((name) => `${name}=${values[name] ?? ""}`).join("\n")}\n`, { mode: 0o600 });
await chmod(nextPath, 0o600);
await rename(nextPath, envPath);
process.stdout.write(`${JSON.stringify({ created: ["dev", "prod"], permissions: ["pinList", "pinFileToIPFS", "pinJSONToIPFS"] })}\n`);
