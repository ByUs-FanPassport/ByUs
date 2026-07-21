import { chmod, open } from "node:fs/promises";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const outputPath = resolve(".env.wallets.prod.local");
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
const contents = [
  `BYUS_PROD_RELAYER_ADDRESS=${account.address}`,
  `GIWA_PROD_RELAYER_PRIVATE_KEY=${privateKey}`,
  "",
].join("\n");

const file = await open(outputPath, "wx", 0o600);
try {
  await file.writeFile(contents, { encoding: "utf8" });
} finally {
  await file.close();
}
await chmod(outputPath, 0o600);
process.stdout.write(JSON.stringify({ outputPath, address: account.address, mode: "0600" }) + "\n");
