# Task 1 report: Telegram certification review database

## Result

Implemented an additive Supabase migration, a focused SQL contract/behavior test, and registration in the Telegram verification script.

Owned files:

- `supabase/migrations/20260915142403_telegram_certification_reviews.sql`
- `supabase/tests/telegram_certification_reviews.sql`
- `scripts/verify-telegram-alerts.sh` (one test registration line)

## Implementation

- Added `certification_review_source` and strict web/Telegram attribution columns and shape constraints to `certification_submissions`.
- Added private, forced-RLS settings, delivery, upload-delivery, and callback-receipt tables. All table grants are revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- Added a disabled singleton review configuration. Enabling requires the existing Telegram alert room to be enabled for the same chat and the shared Telegram command cursor to be enabled.
- Added non-backfilling, exception-isolated submission capture with one outbox row per submission and a 16-byte random callback token.
- Added service-role-only claim, delivery-record, approval, and health RPCs. The internal maintenance/capture/final-review functions are not callable by `service_role` or client roles.
- Added bounded claim/429 retry state, lease recovery, first-message ordering, per-upload provider message persistence, terminal ambiguous-send handling, and 30-day terminal retention.
- Refactored web and Telegram approval through `finalize_certification_review_internal`, retaining the existing generic score/ticket and membership activity/stamp/blockchain transaction.
- Telegram callback approval validates chat, token, action message, delivery completeness, pending status, and revision; it returns explicit `approved`, `already_processed`, or `error` outcomes and records receipts/audit identity.

## TDD evidence

### RED

Initial focused test added only the desired configuration RPC contract, then run before implementation:

```text
PGPORT=55432 PGDATABASE=postgres psql -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/telegram_certification_reviews.sql

BEGIN
psql:supabase/tests/telegram_certification_reviews.sql:8: ERROR:
  TELEGRAM_CERTIFICATION_CONFIG_RPC_MISSING
```

The first attempt against the normal local endpoint was not counted as RED because Docker/Postgres was unavailable; the valid RED above was captured on a clean temporary PostgreSQL instance.

### GREEN

After applying the migration to a clean minimal compatibility schema, the complete focused test passed:

```text
PGPORT=55433 PGDATABASE=postgres psql -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/telegram_certification_reviews.sql

BEGIN
DO
CREATE TABLE
INSERT 0 2
...
DO  (8 behavior blocks)
ROLLBACK
```

Exit code: `0`.

The test covers:

- shared alert-room/command-cursor activation guard and no backfill;
- submission-unique capture;
- table/RPC/internal-core permissions;
- wrong-room and second-claim fencing;
- 128-bit token and worker payload shape without email/member-id fields;
- first/action image ordering and complete multipart delivery;
- callback mismatch and first-click finality;
- Telegram attribution, receipt, audit, and generic score/ticket exactly once;
- web attribution compatibility and web-winner callback finality;
- membership wallet-not-ready remaining pending;
- membership score/activity/stamp/blockchain exactly once;
- stale expected revision remaining pending.

Additional focused lifecycle proof on the temporary database confirmed expired claim recovery, payload/upload creation, `sending -> sent`, persisted action message id, generic approval attribution/reward, and repeat callback finality.

### Final checks

```text
bash -n scripts/verify-telegram-alerts.sh   # exit 0
git diff --check                           # exit 0
```

## Verification limitation / concern

The host has Supabase CLI `2.109.0`, but no Docker daemon or Docker-compatible runtime is installed/running. Therefore `supabase status`, the real clean migration chain, `supabase test db`, advisors, and the existing broader DB suites could not run. The migration itself was parsed/applied and its new behavior test passed on PostgreSQL 17 with a minimal compatibility schema, but this is not a substitute for a clean Supabase stack run. A true two-connection race was also not runnable without a disposable full schema; the SQL test verifies the same row-lock/finality paths sequentially. These should be the first CI/local-Docker follow-up checks.

The Supabase changelog and current official RLS/database-function guidance were checked. No relevant breaking change invalidated the chosen forced-RLS, explicit revoke/grant, or `security definer set search_path=''` patterns.

## Risk-review follow-up

Commit follow-up addresses all five blocking review items:

- Submission capture now gates only on the active singleton observed by the insert trigger. It no longer compares transaction-start `submitted_at` against wall-clock `activated_at`; insert-only capture still prevents backfill.
- Each claim now receives a fresh 128-bit `lease_token`. Every delivery record requires that token, and a reclaimed delivery fences the previous claimant. `sending` is an upload-specific atomic transition and cannot re-enter from `sending`.
- Claim payloads now include `lease_token`, nullable `action_message_id`, and each upload's `delivery_status` plus nullable `provider_message_id`. This lets a reclaimed partial delivery skip known-sent uploads and continue replying to the persisted action message.
- Upload delivery state explicitly distinguishes `pending`, `sending`, `sent`, `failed`, and `delivery_unknown`. Expired in-flight sends are terminal unknown; expired claimed/idle-partial leases can be reclaimed; explicit 429 resets only the known-unsent upload and stops after three claims.
- Added the independent `telegram-certification-review-maintenance` pg_cron job on a five-minute schedule.
- The concurrent web-winner exception path now writes the same Telegram `already_processed` audit identity/reward summary as the normal already-processed path.
- Expanded SQL coverage for transaction-start timestamp capture, expired full and partial claims, stale lease fencing, sending re-entry, upload resume metadata, 429 cap, ambiguous-send terminality, disabled retention, web-winner audit, and repeated membership callback exact-once behavior.

### Follow-up RED evidence

With the original migration applied and the schema-faithful `submitted_at default now()` used, the new timestamp regression test failed at the intended behavior:

```text
psql:supabase/tests/telegram_certification_reviews.sql:75: ERROR:
  TELEGRAM_CERTIFICATION_CAPTURE_MISSING_OR_DUPLICATED
```

The new lease contract test then failed because the old RPC had no claimant token argument:

```text
ERROR: function public.record_telegram_certification_delivery(
  uuid, unknown, text, unknown, uuid, integer
) does not exist
```

The cron contract test independently failed against the original migration:

```text
ERROR: TELEGRAM_CERTIFICATION_MAINTENANCE_CRON_MISSING
```

### Follow-up GREEN evidence

Fresh focused verification after the fixes:

```text
PGPORT=55434 PGDATABASE=postgres psql -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/telegram_certification_reviews.sql

BEGIN
DO
CREATE TABLE
INSERT 0 2
...
DO  (expanded behavior blocks)
ROLLBACK
```

Exit code: `0`.

Also rerun after the final test edits:

```text
bash -n scripts/verify-telegram-alerts.sh  # exit 0
git diff --check                          # exit 0
```

The earlier full-Supabase/Docker limitation remains unchanged; this follow-up used PostgreSQL 17 with schema-faithful defaults and compatibility objects for the existing functions and pg_cron catalog.
