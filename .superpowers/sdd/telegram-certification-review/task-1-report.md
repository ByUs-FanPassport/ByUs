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
