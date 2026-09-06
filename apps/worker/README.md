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
AWS_PROFILE=<explicit-profile> EXPECTED_AWS_ACCOUNT_ID=<verified-prod-account> \
  BYUS_NOTIFICATION_PROD_DEPLOY_CONFIRM=I_UNDERSTAND_BYUS_NOTIFICATION_PROD_MUTATION \
  ./scripts/deploy-aws-notification-worker.sh prod false --dry-run
```

Omit `--dry-run` only during an authorized release. The script creates a
fail-closed Lambda and an EventBridge `rate(1 minute)` rule. A disabled deploy
leaves both the Lambda flag and rule disabled. Enabling requires the exact
`byus/notification/<environment>` secret to exist first. Its execution role can
read only that environment's notification secret; it cannot read mint-worker or
opposite-environment secrets.
Production has no default profile. It requires an explicit `AWS_PROFILE`, an
explicit 12-digit `EXPECTED_AWS_ACCOUNT_ID`, the exact
`BYUS_NOTIFICATION_PROD_DEPLOY_CONFIRM` acknowledgement shown above, and an
exact STS caller-account match before any AWS mutation. Dev and Prod may share
an AWS account; function, role, rule, permission and secret names remain
strictly environment-suffixed.
EventBridge and the Notification Lambda are the canonical scheduler. Every
invocation first runs `enqueue_due_notification_maintenance(now)` (scheduled
notifications, delivery backfill, and Collectible window/availability/expiry
maintenance), then claims and sends. Enqueue failure is fail-closed: no delivery is
claimed or pushed. The protected Web enqueue route is manual diagnostics only;
runtime operation does not require a Vercel cron or `CRON_SECRET`.

## SES notification email

`NOTIFICATION_EXTERNAL_MODE=ses_email` uses the email-only, consent-aware
`claim_email_notification_deliveries` RPC. Region and sender are fixed to
`ap-northeast-2` and `notifications@byus.kr`; batch size must be at most 2.
Deploying code does not enable external delivery: preserve `disabled` until the
real-recipient automatic delivery is explicitly activated.

The B poster template renders real text, one action link and a plain-text fallback.
It supports Korean/English labels, KST dates, the selected B star/rule motif,
separate large date/time rows and a 234px poster-frame/card overlap.
The poster tail preserves the artist image without cropping. Outlook uses a
non-overlapping fallback; the overlap was verified in an actual Naver web inbox. The SES sender embeds the original
ByUs wordmark and published poster as INLINE CID attachments. This avoids the
`Cross-Origin-Resource-Policy: same-origin` restriction on the website's images.
Logo bytes in `src/email-logo.ts` must match the source wordmark under the web
public assets; update both if branding changes.

Posters are fetched only from the trusted site's `/images/` or the configured
Supabase project's public `cms-assets` bucket. Redirects, URL credentials and query
strings are rejected; requests have a 3-second timeout and 3 MiB streaming limit.
JPEG, PNG and the CMS preview pipeline's WebP format have signature validation.
A failed or unsupported poster uses the text artwork fallback. WebP rendering
still depends on the receiving mail client. Pretendard is an optional webfont;
system fonts remain necessary for clients that strip or do not load webfonts.

### Trigger coverage and language

Email supports `live_reserved`, `live_10m`, `live_changed`, `survey_reminder`,
`benefit_available`, `benefit_unlocked`, `benefit_won`,
`recipient_information_required`, `fulfillment_meaningful_update`,
`collectible_claim_available`, `collectible_claim_expiring`, and `level_up`.
The five fulfillment states have separate copy, yielding 16 scenarios / 32 KO-EN
variants. `live_24h` and `live_cancelled` are excluded from direct, fallback, and
already queued email; inbox, push, and Kakao retain those kinds.

Apply `20260906150000_fan_email_trigger_lifecycle.sql` before the worker or web
locale changes. First sign-in initializes a null `app_users.preferred_locale`
from the app locale; Settings PATCH persists explicit subsequent choices.
Existing unset users default to Korean. The delivery plan snapshots email locale,
including Kakao-to-email fallback; Kakao keeps its existing Korean payload.
The email renderer derives subject/body/CTA from kind and locale, not stored
Korean notification copy. CMS titles use the requested locale, with existing
content-localization fallback when that translation is absent.

Claims and `revalidate_email_notification_delivery` check current consent,
schedule, supersession, publication, survey/claim completion, and action state.
Missing required fulfillment/level context or unsupported template keys fail
permanently. Known excluded or no-longer-eligible jobs are terminally suppressed.
A future scheduled job remains queued. Sent records are not rewritten.

Regression verification:

```sh
BYUS_CLEAN_DB_ASSERTION_FILE="$PWD/scripts/verify-fan-email-trigger-lifecycle.sql" \
  bash scripts/verify-clean-migration-chain.sh
npm run test --workspace @byus/worker -- --no-file-parallelism
```

The lifecycle fixture exercises real reservation, scheduler, revision, winner,
fulfillment, tier, and Collectible producers, including stale/completed/consent
cases. Actual SES receipt evidence remains separate from test-sink records.
SES has no idempotency token: a lost provider response or a completion-write
failure can still cause duplicate delivery on retry; leases and source keys do
not provide an exactly-once guarantee.
