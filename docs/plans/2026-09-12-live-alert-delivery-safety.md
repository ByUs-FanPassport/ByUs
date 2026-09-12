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
