# LIVE alert delivery safety

## Scope

User authorized fixes for unsupported Kakao routing and duplicate SES submission, with **no production sends**. On 2026-09-13 the user additionally authorized stopping fan Email/Kakao branches, deploying the reviewed DB migration and notification Lambda, and verifying existing pending preservation. Existing pending, channel consent, schedules, enrollment flags and unrelated secret keys must remain unchanged. No activation, provider call, manual worker invocation or backlog replay is authorized.

## Design

- Choose Kakao for new notifications only when the locale/template and current verified enrollment are supported. Otherwise choose a consented Email channel, preserving the existing Email exclusions for LIVE 24h and cancellation. Do not replan existing notifications.
- A durable Email attempt keyed by delivery ID grants one send permission. Check the current lease generation, destination and eligibility at begin. A lost begin response grants no HTTP permission. Once begun, the same delivery can never be sent automatically or manually again.
- Record provider acceptance separately from actual inbox receipt. Treat provider errors conservatively as unknown; even a retryable network/provider error is not proof that a send was rejected. A failed DB acknowledgement after send must propagate without retrying the provider. A late acknowledgement for the same attempt may resolve unknown to accepted.
- New workers use a new guarded claim RPC. Remove execution permission from legacy claim RPCs and their helpers so old workers cannot bypass begin after a future migration. Block legacy completion/failure/manual retry paths for begun deliveries.
- Migration adds the guard and replaces functions only; no UPDATE, DELETE, backfill or retry of historical delivery rows. Verify this with a nonempty pre-migration fixture and exact row comparison.

## Verification

- [x] Reproduce duplicate sends and unsupported English Kakao routing on prior code.
- [x] Independent plan risk review: require legacy claim denial, ledger filtering in both claim and suppression, null-safe ownership, late acknowledgement and helper ACL checks.
- [x] Worker regression tests, typecheck, lint and bundle.
- [x] Clean PostgreSQL migration replay, existing pending/plan/consent preservation.
- [x] Routing by locale/kind, no Email for excluded kinds, existing plans unchanged.
- [x] Single concurrent begin, stale lease/destination/consent denial, unknown/ACK-loss no resend, late accepted acknowledgement and legacy/manual bypass denial.
- [x] Independent implementation risk review.

## Future activation boundary

Keep fan Email disabled. The observed production batch size is 25; SES mode requires at most 2. Do not enable it as part of code rollout. Before any separately authorized rollout, stop/finish old Email executions and verify no old lease is in flight. Old workers fail closed after this migration; rolling code back must not restore their claim permissions. Existing pending remains a separate backlog decision: do not activate the queue until historical notifications have an explicitly approved exclusion/cutover policy. Kakao enrollment and actual receipt testing remain deferred.

## Evidence

Initial audit and red/green logs: `/tmp/byus-live-alert-audit-20260912/`. Source baseline: `3fc9667215786528d1b25f023f9f0d4badbe4f70`. Working branch: `codex/live-alert-delivery-safety-20260912`.


## Current verification checkpoint

- Worker: 40 files / 492 tests passed (`worker-full.log`); typecheck and Lambda bundle passed. The first four new worker regressions failed against the baseline, then passed after the guard integration.
- SQL routing regression failed against the baseline with `en live_10m routes to email`, then passed. Full backend security now passes, including 153 migrations, pre/post upgrade exact snapshots, existing Kakao/Telegram/mint checks and simultaneous Email begin (`backend-security-3.log`).
- Test fixture preparation errors (publication constraints, phone collision) were confined to disposable local PostgreSQL and corrected using the existing validated fixture schema and a separate `0108` phone namespace. Earlier failure logs remain preserved.
- Worker-only dependency installation lacked the repository lint dependencies. Full locked installation completed; final `npm run lint:worker` and Worker typecheck passed (`lint-final.log`, `typecheck-final.log`). No package or lockfile changes.
- Independent final risk review approved the implementation and successful logs; no blocking findings remain. Sender exceptions conservatively consume the send permission as unknown, even when the failure could precede SES submission. This prioritizes preventing duplicate messages and may leave an unsent email for manual investigation, without permitting resend.
- At the local verification checkpoint, no production changes or sends had been performed; subsequent authorized deployment is tracked below.

Completed locally on 2026-09-13 KST. Production activation and delivery remain excluded.

## Authorized production rollout — 2026-09-13 KST

- Stop only fan Email/Kakao modes, verify unrelated keys preserved, drain the existing 60-second Lambda timeout.
- Record existing outbox/plan/channel hashes; require no processing rows. Apply only migration `20260912144419` and its migration-ledger entry in one transaction with unchanged-row assertions.
- Deploy the already validated node24 bundle as ZIP-root `index.cjs` to the unqualified notification Lambda with revision guard; verify Active/Successful and ZIP hash. Preserve the previous ZIP for code-only rollback; never restore the prior secret version because it would re-enable Kakao.
- Keep historical pending untouched and both fan sending modes disabled. Cutover/exclusion policy, Kakao enrollment and recipient tests remain separate future work.
- Evidence directory: `/tmp/byus-live-alert-rollout-20260913/`.

### Production result

Completed 2026-09-13 00:16 KST. Deployed source: `a315c75bc72d73d976c95bd54b7c4f664531b270`.

- Both fan modes explicitly `disabled`, read back before and after deployment. All other secret keys preserved; Telegram/business inquiry branches and EventBridge target/schedule unchanged. No worker invocation or recipient test was performed.
- After more than the previous Lambda's 60-second timeout: Email pending 71, attempt total 0, processing 0, Kakao attempt ledger 0.
- Applied only `20260912144419_live_alert_delivery_safety` and its migration-ledger row in one transaction. Temporary before/after full-row hash assertions passed. Migration source SHA-256: `8029cc5450d13948cf190a4a11994742cd1da207267e9879603f155d62968bd0`.
- Final comparison: existing outbox 71/71, plans 71/71, channels 104/104 exactly preserved, no additional rows. Email/Kakao send-attempt ledgers both 0. Guarded claim/begin/finish permissions, old claim denial, ledger direct-access denial and forced RLS all verified read-only.
- `byus-notification-worker-prod`: `Active / Successful`; verified ZIP-root `index.cjs`, nodejs24.x. Uploaded and deployed CodeSha256: `3QiwLPx1Uoe+bp2NVtNnvWZgPkjSlTSt2pcx9RwX8xc=`. Code-only deployment preserved existing Lambda environment/role/runtime/handler/timeout/memory/architecture. Existing BUILD_COMMIT/BUILD_TIMESTAMP environment metadata was preserved, so identify this deployment by the code hash and source commit above.
- Previous ZIP is retained at `/tmp/byus-live-alert-rollout-20260913/previous.zip`; its CodeSha256 is `REA/LqBEmW/sOxoYv5I99fMHCzAw8fuxMb4hXdETcOk=`. Recovery must keep both fan modes disabled and legacy Email claim permissions denied.
- Read-only deployment wrapper review found no blockers. All original local tests were reused because code/dependencies had not changed; the final documentation update does not change runtime behavior.
- Source is retained on `codex/live-alert-delivery-safety-20260912`; this rollout does not merge or deploy unrelated web work. Integrate this branch before a future routine worker release. Fan activation still requires a separately approved historical-backlog cutover policy and controlled receipt verification.

## Historical backlog exclusion — 2026-09-13

User authorized main integration, a historical-pending exclusion gate, and provider readiness checks. Real recipient testing still requires separately approved test account(s); both provider modes remain disabled.

- New private per-channel release control starts disabled. Only a database operator can configure it; API/runtime roles cannot read, write or activate it. No caller supplies the cutoff. The database records a fresh timestamp after obtaining the control lock for every test/enabled transition.
- Claims and pre-send entry points require notification creation strictly after the current cutoff. Test mode additionally allows only 1–2 explicitly selected active user IDs. A new plan for an old notification does not bypass the cutoff. Pause/re-activation excludes both old and pause-period notifications.
- Excluded pending rows are preserved, including Email suppression/revalidation/legacy failure/completion, Kakao pre-begin suppression, and manual retry. Begun attempts may still record ACKs/results. Pause must still drain calls that obtained begin permission before it committed.
- Red test reproduced the previous historical claim behavior. `backend-final.log` passes 154 migrations, existing regressions, exact upgrade snapshots, release-window/test/ACK/ACL checks, and observed Email/Kakao control-lock races in both pause-first and begin-first order. Independent implementation review approved with no remaining blockers.
- Provider readiness: SES production account/domain/DKIM and configured sender IAM condition verified. An initial IAM simulation omitted `ses:FromAddress`; the corrected configured-domain simulation is allowed, so no IAM change is needed. Email batch 25 must be reduced to at most 2 before SES activation. SOLAPI authenticates and all 11 runtime templates are approved and sendable. Kakao has zero verified recipient enrollments; current Kakao app phone-number permission remains unverified.
- Sanitized evidence: `/tmp/byus-live-alert-cutover-20260913/`. Only this new migration is to be applied; no backlog UPDATE/DELETE, provider-mode activation or manual worker invocation.

### Cutover deployment evidence

- Integrated current main's unrelated Instagram self-service migration without conflict and reran the affected full DB suite: `backend-integrated.log`, **155 migrations and all existing/new SQL and concurrency checks pass**. Worker source and dependencies did not change in this phase; prior 492 worker tests, lint/typecheck and deployed bundle evidence remain applicable.
- Applied `20260912152008_live_alert_delivery_cutover` plus migration-ledger record atomically. SHA-256: `538cde0059ef5d675aa27849e7693f6c612e87a934cdea7317a95606640ddeba`.
- Production post-check: existing outbox 71/71, plans 71/71, channels 104/104 unchanged; historical rows blocked 71, released rows 0, Email/Kakao attempt ledgers 0. Both DB controls are disabled, no activation timestamp and no test users. Runtime activation/helper/direct-table privileges are denied and forced RLS is enabled.
- Provider secret retains the same disabled version from the earlier rollout. Notification Lambda remains Active/Successful with the previously verified safety bundle hash; this DB-only phase requires no Lambda code upload.
- No actual notification send, pending replay/deletion, recipient enrollment or general activation was performed. Before a separately approved recipient test, configure only the approved account(s) in DB test mode and cap Email batch size at 2 while provider modes remain disabled; confirm Kakao permission/enrollment. Enable only the approved channel for the bounded test, then disable and drain it. General release requires a fresh activation cutoff and separate approval.

## Approved single-recipient provider test — 2026-09-13

The user supplied owned recipient details and approved proceeding with one Email and one Kakao test. These were isolated direct calls through the existing production sender adapters, with exclusive per-channel attempt markers and SDK retries disabled. Production queues, provider modes, DB release controls and registration records were not changed. This proves adapter/provider delivery, not production queue scheduling or the Kakao enrollment journey.

- Email: exactly one SES acceptance, followed by direct received-inbox confirmation at 00:42:37 KST. Subject used the approved LIVE reservation template; the event-title field explicitly identified the receipt test. SES Message Insights was unavailable for this message, so receipt evidence came from the mailbox instead.
- Kakao: exactly one submission, SMS fallback disabled. The acknowledged single-message group returned COMPLETE / 4000 with matching delivery key, recipient fingerprint, group/message IDs, channel and template, no replacement, and receipt time 00:42:44 KST.
- Actual Kakao Developers screen: app 1568460 phone_number has no permission and is disabled; business information and personal-data review remain pending. ByUs account has Kakao linked, but verified phone enrollment remains unavailable. Do not fabricate enrollment or treat direct provider success as that journey passing.
- The global SOLAPI list lookup repeatedly returned an empty list for the delivered test message. The documented acknowledged-group endpoint returned the fully correlated result. Changed only the worker lookup to that endpoint, retaining strict result correlation and validating the group ID before constructing the URL. No re-send was used for diagnosis or validation.
- Failing regression reproduced the old lookup; focused Solapi client + Kakao worker tests **51 passed**, typecheck, lint and Lambda bundle passed. The patched adapter also returned delivered / 4000 for the same actual message through a read-only lookup.
- Exact before/after hashes: outbox 71, plans 71 and channels 104 preserved. Both fan provider modes and DB release controls stay disabled. General user activation remains outside this approval.
- Private local evidence (recipient details not committed): `/tmp/byus-live-alert-recipient-test-20260913/`.
- Provider reference: https://solapi.com/developers/api/msg-groups-getGroupMessageList

## Manual phone registration — 2026-09-13

User authorized implementing and deploying direct phone input → SMS ownership verification → explicit service-notification consent → Alimtalk registration. This authorization does not enable general fan notifications or replay historical pending items. No additional real test SMS, Email, or Alimtalk was sent.

- Settings offers the manual route independently of Kakao OAuth. The existing profile-phone route remains compatible. Confirming either method invalidates older unfinished enrollment proofs from the other method. SMS registration survives Kakao-account disconnect; explicit notification withdrawal or owner disable revokes it.
- Server-only SOLAPI SMS configuration is separate from `NOTIFICATION_EXTERNAL_MODE`, `KAKAO_ALIMTALK_MODE`, and DB release controls. Existing approved sender was checked read-only. The browser receives no provider secret, raw stored phone, OTP digest or provider receipt ID.
- Six-digit random codes use an owner/challenge-bound HMAC; no clear OTP is stored in Postgres. Codes expire in 5 minutes, allow 5 incorrect attempts, and require separate fixed-version consent to enroll. Durable limits: one request per owner/phone per 60 seconds, 3 per 10 minutes, 10 per 24 hours, global 100 per 24 hours. Request UUIDs prevent duplicate submission; only the winning DB send CAS can make a single provider call. Unknown outcomes do not auto-retry; an arrived code can still be verified.
- Consumed/cancelled phone and digest are removed immediately. Five-minute scheduled cleanup removes expired challenge PII; sanitized challenge/rate records expire after 24 hours. Current registered phone stays in the existing private destination table until replaced/revoked.
- Alimtalk attempt snapshots now distinguish `sms_otp` from `kakao_profile_owner_confirmation`. SMS requires a NULL Kakao subject; OAuth requires a matching connected subject. Method, generation, destination and consent must still match immediately before sending. Existing release-control wrapper is retained.
- Validation: focused web/API/provider/settings/env and existing Kakao tests pass (148 combined); web lint/typecheck pass. Actual local React renderer with Settings parent CSS passes KO 360/1440px and EN 360px input→code→unchecked consent→registration, no horizontal overflow. Provider responses were mocked; this is not live OTP receipt proof. Browser evidence is in `/Users/jewel/.aside/u/0/sessions/2026-09-13_lpS7t5wCnHowHlvB/artifacts/byus-manual-phone-20260913/`; its hard-coded preview heading is not product copy.
- Reviewer findings fixed: withdrawn queued channel no longer violates an attempt method NOT NULL constraint; OAuth subject NULL checks are explicit; late provider ACKs cannot revive expired challenges; hashed rate identifiers are purged; request bodies stop reading beyond 1KB. Parent switch CSS was narrowed to direct channel switches so it cannot restyle phone inputs.
- Operational evidence: `/tmp/byus-manual-phone-20260913/`; production preflight at 01:18 KST has 72 Email pending (one new item since earlier 71), no send attempts or processing. Apply transaction asserts all preexisting outbox/plan/channel row hashes unchanged and both fan controls disabled. Existing Kakao attempt count must remain zero for the historical snapshot backfill preflight.

### Manual phone rollout evidence

- Full backend replay passes **157 migrations**, existing safety suites, and observed SMS idempotency/quota/single-begin/confirm-cancel/confirm-withdraw/disable-confirm lock races. Final log: `/tmp/byus-phone-sms-backend-db-20260913.log`. Independent review approved after the fixes above.
- Applied only migration `20260912160833_manual_phone_sms_enrollment` and its ledger record atomically. Source SHA-256: `25975b8c9253c8320a9bafee9a8c67f1e03993b76f7fb1d42eadd2a878fad0ec`. Production row-hash assertions pass: outbox 72/72, plans 72/72, channels 104/104 unchanged. Both DB release controls disabled, released deliveries 0, Email/Kakao attempts 0, SMS challenges 0.
- New challenge/rate tables have forced RLS and no direct service-role access; anonymous reservation denied, service-only RPC allowed. Cleanup cron is active every 5 minutes. Supabase MCP security-advisor query was denied by connector permissions; the targeted SQL RLS/ACL/release checks passed directly.
- Added five SMS registration variables only to Vercel Production as sensitive server-only values, with the existing approved sender and a separate random OTP secret. Existing fan provider modes remain disabled. No Lambda source changed in this phase, so its verified deployed code is reused.
- General LIVE fan delivery remains disabled. The new registration path is prepared for user-initiated OTP requests after the web deployment; no actual OTP request was used as a test during this work.
