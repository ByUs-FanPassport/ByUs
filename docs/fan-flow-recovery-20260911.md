# Fan flow recovery — 2026-09-11

## Scope and completion

User authorized the recommended login/participation recovery fixes and production push. Preserve identity, wallet ownership, Apple reauthentication, and server idempotency checks. No real user signup, wallet creation, reservation, raffle submission, or external messages in verification. Finish after scoped tests, typecheck/lint, local rendered failure/recovery checks, and the pushed commit's automatic deployment starts.

## Implementation plan

1. Shared client deadlines: 20-second request deadline including response parsing; SDK operations can use 30 seconds. Abort fetches and reject on deadline even if the transport ignores abort. Clear timers/listeners. No automatic mutation retry. Do not interpret a timeout as proof the server did not commit.
2. Login: bound readiness and each asynchronous stage, surface recoverable timeout with a retry, and record only allowlisted stage/code (no raw errors, tokens, IDs, URLs or user data). Retain the in-flight wallet creation promise per current identity so a timeout/retry never creates concurrent wallets. Ignore late completion for replaced/unmounted identities. Identity/profile and lifecycle checks remain blocking. Language projection is best effort. Notification projection may be deferred only when a boolean-only service-role proof binds the canonical owner and confirms no prior email channel, or an exactly matching recipient and Google connection. Each ancillary call/proof has a 2-second budget so they do not exhaust the 30-second login request. Identity/recipient uncertainty still fails closed.
3. Participation: bound quiz loading/submission and LIVE reservation/attendance as needed to avoid stuck controls; bound raffle token/request/reconciliation. Valid reservation POST receipt establishes success even if subsequent display refresh fails. On uncertain outcomes re-read authoritative state and retain the same attempt/request key for explicit retry; never infer a raffle receipt from an aggregate balance. Preserve its existing durable unresolved-request and identity-generation safety.
4. Storage: navigation/auth-intent and nickname draft storage use an exception-safe session-storage facade with in-memory fallback. Auth-intent helpers also tolerate throwing storage implementations and preserve URL return context. Keep durable-storage requirements for ticket-spending raffle mutations; if unavailable show an accurate actionable storage error instead of silently submitting a non-durable new request.
5. Recoverability: existing KO/EN components and styling remain the source. Distinguish timeout/unknown outcome from confirmed rejection; offer result recheck/same-request retry, never claim cancellation rolled back a server mutation.

## Shared helper contract

- `features/reliability/client/request-deadline.ts`: `RequestTimeoutError`, `DEFAULT_REQUEST_TIMEOUT_MS = 20_000`, `withRequestDeadline<T>((signal) => Promise<T>, { timeoutMs?, signal? }?)`, `withOperationDeadline<T>(promise, timeoutMs?)`, `reportRecoveryFailure(stage, error)` with sanitized metadata only. Wrap response JSON parsing inside the deadline callback.
- `features/reliability/client/session-storage.ts`: `getSessionStorage()` returns a `Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>` facade. Use for navigation/drafts; not a substitute for durable ticket-spending keys.

## Validation checklist

- [x] Independent plan review and resolution of safety concerns.
- [x] Deadline tests: never-resolving work releases controls; abort/late completion do not corrupt current identity; wallet retry reuses in-flight creation.
- [x] Reservation POST success + failed refresh remains success; uncertain request can recover without a new key.
- [x] Quiz submission response loss can recover the already-closed attempt/result; pending requests expire safely.
- [x] Raffle timeout preserves exact immutable request and unlocks controls; receipt survives reconciliation failure; durable storage failure stays safe.
- [x] Storage read/write failures no longer prevent login navigation or nickname editing.
- [x] Locale failures and proven-safe notification failures do not block valid identity/profile; critical failures and unproven recipients reject; logs contain only stage/code.
- [x] Scoped tests, typecheck, targeted lint; local desktop/mobile rendered recovery evidence.
- [x] Independent final review. Release evidence (pushed commit and exact Vercel status URL) is recorded in `artifacts/fan-flow-recovery-20260911/release.json` after pushing.

## Existing evidence

- `9c3b465` enables Privy's embedded-browser OAuth attempts. 32 login/provider tests, typecheck and lint passed. Isolated iPhone-UA + SDK opt-in reached Google account input; actual iPhone OAuth completion was not exercised.
- Read-only fault injection showed auth-intent storage helpers leaked `QuotaExceededError`/`SecurityError`. URL `returnTo` survives an empty browser store, so missing storage alone is not treated as complete return-path loss.


## Review decisions and validation

- Quiz answer PUT remains unchanged: the current SQL permits a late answer write to overwrite a later choice, so a timeout must not unlock new writes. Submit/result reads retain the same attempt and are recoverable.
- LIVE reservation keys now include the Privy owner. Account change invalidates pending results; an old account cannot poison another account's retry. A recovered GET proves the reservation but cannot recreate POST-only completion details.
- Login retains wallet creation until the underlying SDK operation actually settles; retries reuse it. React Strict Mode setup, external logout, identity change, and late reauthentication responses are covered.
- Direct SELECT on notification tables is deliberately revoked from service_role. A new `can_defer_owned_notification_sync` function returns only a boolean; PUBLIC/anon/authenticated execution stays denied. No table grants or recipient changes were introduced.
- Existing successful duplicate-email conflicts in `sync_owned_google_notification_channel` can preserve an owner's older email channel. This pre-existing recipient policy was identified separately; the new failure-only proof rejects mismatched recipients and does not broaden this change into recipient-policy mutation.
- Main integration suites: 11 files / 126 tests passed, then updated auth/participation 9 files / 140 tests passed (two overlapping suites; 18 unique files / 249 tests at this checkpoint). Additional final modal tests recorded below.
- Web typecheck, all changed TS/TSX ESLint, and diff whitespace checks passed. The only test diagnostic was jsdom's unsupported document navigation; no test failures remained.
- Production DB rollback preview verified service-role RPC execution, denied anonymous/user execution, preserved private table denial, nonexistent/wrong owner/email rejection, and old-recipient mismatch rejection. Queries were read-only apart from rolled-back DDL. No test accounts, wallets, reservations, entries, or outbound notifications were created.
- Official Supabase function permissions guidance checked; changelog had no relevant API change. Source: https://supabase.com/docs/guides/database/functions

## Local render evidence

Actual source components and CSS are served by an isolated Vite harness at port 4317 with synthetic auth/API responses and compressed timers. Evidence is in `artifacts/fan-flow-recovery-20260911/`. This verifies rendered behavior only, not actual iPhone OAuth completion or live API integration.

- Final refinement: actual raffle dialog tests KO/EN 3/3 and updated LIVE lifecycle 50/50 passed; earlier unchanged suites reused. Modal timeout now offers same-request retry directly and closes truthfully. Scoped raffle CSS fixes portal font inheritance and retains the intended 470px desktop dialog width despite shared overlay max-width specificity.
- Browser evidence: login timeout/retry KO/EN at 390/1440; raffle timeout + explicit retry at 390/1440 with identical serialized request bodies, enabled retry, zero page errors, and no horizontal overflow. Modal width: 358px mobile, 470px desktop. Main visually inspected final screenshots.
- Aside desktop verified reservation success survives failed follow-up GET. Quiz browser route spy confirmed POST submit -> GET same attempt -> `/c/kara/verify/result?attempt=...&locale=ko`. The harness router records navigation rather than changing documents; initial Aside apparent quiz failure was this harness limitation, resolved by inspecting the captured route. No claim of a live result-page roundtrip.
- DB migration `20260911130228` applied atomically with its migration ledger. Read-only owner/recipient/ACL assertions passed inside the transaction; security advisors returned no issues before/after.

## Final integration

- Integrated concurrent `origin/main` changes through `b0ea2a7` without conflicts. The shared profile onboarding merge preserves both generic setup and exception-safe storage.
- Final merged web typecheck passed. Focused integration verification (profile onboarding, global next-action guide, raffle dialog) passed 3 files / 26 tests. Earlier unchanged auth/participation suites were reused.
- Source change: `b205f15`; merged tree: `1c1c887` before this documentation-only release checkpoint.
