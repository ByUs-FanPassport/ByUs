# ByUs mint worker

One-shot, lease-based Passport/Stamp mint worker. It is disabled unless
`WORKER_ENABLED=true` is supplied explicitly. The package does not schedule
itself; Supabase remains the single cron/queue source of truth.

## Recovery invariant

The worker signs locally, then persists both the expected transaction hash and
the signed raw transaction while it still owns the database lease. Only then
does it broadcast. A retry re-broadcasts the identical bytes, so it cannot
consume a second nonce or create a second credential. Before any preparation it
also reconciles the contract's unique key mapping and mint event.

## Commands

```sh
npm test
npm run typecheck
npm run build
```

Copy `.env.example` to an ignored environment-specific file. Never place the
service role, Pinata JWT, or relayer private key in a web or `NEXT_PUBLIC_`
environment.

`METADATA_ASSET_BASE_URI` must be a versioned `ipfs://` CID. Mutable HTTPS
artwork is rejected. Run one active replica per relayer account until nonce
reservation is coordinated at the database layer.

## AWS Lambda deployment

`npm run build:lambda` creates the Node.js 24 Lambda bundle. Package it as
`apps/worker/lambda-package.zip`, then deploy each environment explicitly:

```sh
./scripts/deploy-aws-worker.sh dev false
./scripts/deploy-aws-worker.sh prod false
```

Both functions are created disabled and with reserved concurrency `1`. The
Lambda execution role can read only `byus/worker/<environment>` in Secrets
Manager. Enabling a function requires a complete, strictly validated secret
including an immutable metadata asset CID; never enable it with placeholder
metadata or a shared Dev/Production secret.
