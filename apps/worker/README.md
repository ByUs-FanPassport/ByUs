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

The notification delivery worker is packaged and deployed independently, so
mint worker configuration and scheduling remain unchanged. Validate the bundle,
IAM document and exact target names without contacting AWS:

```sh
./scripts/deploy-aws-notification-worker.sh dev false --dry-run
AWS_PROFILE=coredot-prod EXPECTED_AWS_ACCOUNT_ID=<isolated-prod-account> \
  ./scripts/deploy-aws-notification-worker.sh prod false --dry-run
```

Omit `--dry-run` only during an authorized release. The script creates a
fail-closed Lambda and an EventBridge `rate(1 minute)` rule. A disabled deploy
leaves both the Lambda flag and rule disabled. Enabling requires the exact
`byus/notification/<environment>` secret to exist first. Its execution role can
read only that environment's notification secret; it cannot read mint-worker or
opposite-environment secrets.
Production rejects the default or `coredot-dev` profile. It requires the
committed approved profile name `coredot-prod`, an explicit 12-digit
`EXPECTED_AWS_ACCOUNT_ID` different from the Dev account, and an exact STS
caller-account match before any AWS mutation.
EventBridge and the Notification Lambda are the canonical scheduler. Every
invocation first runs `enqueue_due_fan_notifications(now)` (including delivery
backfill), then claims and sends. Enqueue failure is fail-closed: no delivery is
claimed or pushed. The protected Web enqueue route is manual diagnostics only;
runtime operation does not require a Vercel cron or `CRON_SECRET`.
