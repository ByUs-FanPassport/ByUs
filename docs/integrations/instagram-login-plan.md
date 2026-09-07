# Instagram Login integration checkpoint

Scope approved by parent task 01a07c78-ef91-7ac0-8755-ff220171e9bc, 2026-09-08:
- Operator issues one-use creator link. Creator logs into Instagram, checks actual account, explicitly confirms.
- Read-only minimum instagram_business_basic. Latest three photos/reels, carousel representative included. Original Instagram permalink is default interaction; no download/rehosting.
- Keep media type/product type/image or thumbnail/permalink/caption/timestamp/source account separate.
- Independent worktree; do not modify docs/design/byus.pen or fanpage design docs. Parent now authorizes scoped commit/push and integration; parent owns production merge/deploy. No independent production deployment, app review submission, or external-person messages.

Plan: server-only provider adapter; encrypted persistent connection and browser-bound one-time OAuth states; admin invite/disconnect routes; creator start/callback/confirm; cron sync; public fresh media DTO; signed deauthorization/deletion callbacks; review runbook.

Security review (risk_reviewer, read-only) accepted with corrections:
- Local disconnect atomically erases token/cache and advances durable celebrity generation before bounded remote revoke attempt.
- Durable generation guards every invite/state/pending/confirm/sync; disconnect invalidates outstanding flows.
- Reuse current admin gate and explicitly reject viewer writes.
- No-store/same-origin referrer flow pages (external referrer suppressed; native POST Origin preserved), browser-bound CSRF, no secrets in logs; service-role-only RPC grants.

Progress:
- [x] Current code and administrator authentication inspected.
- [x] Parent confirmed flow and media contract.
- [x] Independent security plan review incorporated.
- [x] Provider official references / Meta console inventory. Dedicated ByUs Meta1732948291088067 / IG3397133600468084 confirmed, unpublished, no account; all3 byus.kr callbacks saved and verified after reload.
- [x] Implementation and focused verification:43 Instagram tests +32 regression/header tests, TypeScript/build/lint, local SQL lifecycle/ACL and4 concurrent schedules, Dev migration/ACL, desktop/mobile browser fixture checks.
- [ ] Actual test-account OAuth and media proof (credentials/assets not yet available).

Current evidence limits: real creator consent, live token/profile/media, 24h token refresh and provider webhook delivery remain unverified. Default feature OFF. Dedicated Meta app IDs confirmed; permission testing state requires final live recheck; no production changes in this worktree.

2026-09-08 browser finish: start/confirm/cancel at1440/390, all3 portrait9:16 cards and video-only play mark, mobile scroll to third card, original new-window link. Captures in instagram-render-proof/. Final run intercepts all Meta navigation through CDP; earlier failed test reached logged-out Meta login with fake client ID and no creator token, not live OAuth success.

Meta callbacks verified after reload. Instagram secret obtained via saved login reauth, protected0600 env + new encryption key prepared outsideGit; defaultOFF. Remaining parent deploy/env inject, approved creator tester+consent and live API proof. Own local4319 server/Postgres56487 stopped; logs/captures retained.
