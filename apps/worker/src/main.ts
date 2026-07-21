import { parseEnv } from "./env.js";
import { runWorkerOnce } from "./runtime.js";

const env = parseEnv(process.env);
if (!env.WORKER_ENABLED) throw new Error("Worker activation refused: set WORKER_ENABLED=true explicitly");

const claimed = await runWorkerOnce(env);
process.stdout.write(`${JSON.stringify({ event: "worker_run_complete", claimed })}\n`);
