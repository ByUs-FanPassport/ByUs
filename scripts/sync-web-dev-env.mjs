import { chmod, writeFile } from "node:fs/promises";
import { developmentLocalEnvironment, DEVELOPMENT_ENV_PATH, serializeEnvironment } from "./local-development-env.mjs";

const environment = await developmentLocalEnvironment();
await writeFile(DEVELOPMENT_ENV_PATH, serializeEnvironment(environment), { encoding: "utf8", mode: 0o600 });
await chmod(DEVELOPMENT_ENV_PATH, 0o600);
console.log("wrote isolated localhost + Dev Supabase + Privy Development + GIWA testnet environment");
