import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const positiveInteger = z.coerce.number().int().positive();
const url = z.string().url();

const envSchema = z.object({
  WORKER_ENABLED: booleanString.default(false),
  WORKER_ID: z.string().min(3).max(120),
  WORKER_BATCH_SIZE: positiveInteger.max(100).default(5),
  WORKER_LEASE_SECONDS: positiveInteger.min(30).max(900).default(120),
  WORKER_POLL_INTERVAL_MS: positiveInteger.default(5_000),
  WORKER_RECEIPT_POLL_ATTEMPTS: positiveInteger.max(120).default(24),
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  PINATA_JWT: z.string().min(40),
  PINATA_API_URL: url.default("https://api.pinata.cloud"),
  METADATA_ASSET_BASE_URI: z.string().regex(/^ipfs:\/\/[a-zA-Z0-9]+(?:\/.*)?$/, "metadata assets must use an immutable ipfs:// base URI"),
  GIWA_RPC_URL: url,
  GIWA_CHAIN_ID: z.coerce.number().int().refine((value) => value === 91342, "GIWA testnet chain id must be 91342"),
  GIWA_RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  BYUS_PASSPORT_CONTRACT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  BYUS_STAMP_CONTRACT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  GIWA_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative(),
}).strict();

export type WorkerEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const known = Object.fromEntries(Object.keys(envSchema.shape).map((key) => [key, source[key]]));
  return envSchema.parse(known);
}
