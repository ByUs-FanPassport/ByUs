import { spawnSync } from "node:child_process";

const sourceEnvironment = process.argv[2];
const vercelTarget = process.argv[3];
const publicOnly = process.argv[4] === '--public-only';
if (!['dev', 'prod'].includes(sourceEnvironment) || !['preview', 'production'].includes(vercelTarget)) {
  throw new Error('usage: node scripts/configure-vercel-env.mjs <dev|prod> <preview|production>');
}

const prefix = sourceEnvironment === 'dev' ? 'DEV' : 'PROD';
const values = {
  NEXT_PUBLIC_APP_URL: process.env.VERCEL_APP_URL,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
  SUPABASE_URL: process.env[`SUPABASE_${prefix}_URL`],
  SUPABASE_SERVICE_ROLE_KEY: process.env[`SUPABASE_${prefix}_SERVICE_ROLE_KEY`],
  GIWA_CHAIN_ID: process.env.GIWA_CHAIN_ID,
  GIWA_RPC_URL: process.env.GIWA_RPC_URL,
  GIWA_EXPLORER_URL: process.env.GIWA_EXPLORER_URL,
  BYUS_PASSPORT_CONTRACT_ADDRESS: process.env.BYUS_PASSPORT_CONTRACT_ADDRESS,
  BYUS_STAMP_CONTRACT_ADDRESS: process.env.BYUS_STAMP_CONTRACT_ADDRESS,
  BYUS_RELAYER_ADDRESS: sourceEnvironment === 'prod'
    ? process.env.BYUS_PROD_RELAYER_ADDRESS
    : process.env.BYUS_RELAYER_ADDRESS,
};

const selectedValues = publicOnly
  ? Object.fromEntries(
      Object.entries(values).filter(([name]) => name.startsWith('NEXT_PUBLIC_')),
    )
  : values;

const missing = Object.entries(selectedValues)
  .filter(([, value]) => typeof value !== 'string' || value.length === 0)
  .map(([name]) => name);
if (missing.length > 0) {
  throw new Error(`missing Vercel source variables: ${missing.join(', ')}`);
}

for (const [name, value] of Object.entries(selectedValues)) {
  const result = spawnSync(
    'npx',
    ['--yes', 'vercel@latest', 'env', 'add', name, vercelTarget, '--force'],
    { cwd: process.cwd(), input: `${value}\n`, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`failed to set ${name} for ${vercelTarget}`);
  }
  console.log(`configured ${name} for ${vercelTarget}`);
}
