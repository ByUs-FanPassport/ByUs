import {
  CreateSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const environment = process.argv[2];
if (environment !== "dev" && environment !== "prod") {
  throw new Error("Usage: node scripts/configure-aws-worker-secret.mjs <dev|prod>");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const prefix = environment === "dev" ? "SUPABASE_DEV" : "SUPABASE_PROD";
const pinataPrefix = environment === "dev" ? "PINATA_DEV" : "PINATA_PROD";
const secretName = `byus/worker/${environment}`;
const secret = {
  WORKER_ENABLED: "true",
  WORKER_ID: `byus-worker-${environment}-01`,
  WORKER_BATCH_SIZE: "5",
  WORKER_LEASE_SECONDS: "300",
  WORKER_POLL_INTERVAL_MS: "5000",
  WORKER_RECEIPT_POLL_ATTEMPTS: "24",
  SUPABASE_URL: required(`${prefix}_URL`),
  SUPABASE_SERVICE_ROLE_KEY: required(`${prefix}_SERVICE_ROLE_KEY`),
  PINATA_JWT: required(`${pinataPrefix}_JWT`),
  PINATA_API_URL: "https://api.pinata.cloud",
  METADATA_ASSET_BASE_URI: required("METADATA_ASSET_BASE_URI"),
  GIWA_RPC_URL: required("GIWA_RPC_URL"),
  GIWA_CHAIN_ID: required("GIWA_CHAIN_ID"),
  GIWA_RELAYER_PRIVATE_KEY: required("GIWA_RELAYER_PRIVATE_KEY"),
  BYUS_PASSPORT_CONTRACT_ADDRESS: required("BYUS_PASSPORT_CONTRACT_ADDRESS"),
  BYUS_STAMP_CONTRACT_ADDRESS: required("BYUS_STAMP_CONTRACT_ADDRESS"),
  GIWA_DEPLOYMENT_BLOCK: required("GIWA_DEPLOYMENT_BLOCK"),
};

const client = new SecretsManagerClient({ region: required("AWS_REGION") });
const secretString = JSON.stringify(secret);
try {
  await client.send(new CreateSecretCommand({
    Name: secretName,
    Description: `ByUs ${environment} mint worker runtime configuration`,
    SecretString: secretString,
    Tags: [
      { Key: "Project", Value: "ByUs" },
      { Key: "Environment", Value: environment },
      { Key: "Component", Value: "mint-worker" },
    ],
  }));
  process.stdout.write(`${JSON.stringify({ environment, secretName, action: "created", fieldCount: Object.keys(secret).length })}\n`);
} catch (error) {
  if (error?.name !== "ResourceExistsException") throw error;
  await client.send(new PutSecretValueCommand({ SecretId: secretName, SecretString: secretString }));
  process.stdout.write(`${JSON.stringify({ environment, secretName, action: "updated", fieldCount: Object.keys(secret).length })}\n`);
}
