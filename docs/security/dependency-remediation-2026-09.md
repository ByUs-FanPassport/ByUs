# Production dependency remediation — 2026-09-05

## Audit and remaining risk

Locked production audit (`npm audit --omit=dev --ignore-scripts`): **Critical 0, High 0, Moderate 10**, down from 0/1/52. The baseline is tightened from 12 to 10; resolved PostCSS/Next entries and advisory 1117015 are removed. No new advisory is accepted.

The remaining ten package effects all derive from [UUID GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), advisory 1119441: uuid, MetaMask utilities/RPC/SDK packages, Gemini wallet core, Wagmi connectors/Wagmi, x402, and Privy. Privy 3.35.1 carries x402 → Wagmi → connectors → UUID 8/9. ByUs uses Google/email authentication and Privy embedded wallets; reviewed application code does not invoke UUID v3/v5/v6 with caller-provided buffers, the vulnerable condition. This is not proof that every upstream path is unreachable and not a zero-vulnerability claim. Do not add direct connector or UUID-buffer calls without review. A cross-major UUID 11 override or Privy downgrade is not accepted.

## Scoped changes

- Tiptap packages aligned at 3.31.3; patched core minimum 3.30.4. Fixes [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh).
- Nanoid 3.3.16 → 3.3.18 within PostCSS's supported range. Fixes [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8).
- Hono 4.12.31 → 4.13.7 within Porto's supported range. Reported CORS/SSG/proxy/language advisories require at least 4.12.34.
- Scoped override `@walletconnect/utils@>=2.21.0 <2.21.9` → `2.21.9`: upstream patch removes query-string7 and its legacy decoder. Existing newer utils copies stay unchanged. This removes [decoder DoS GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) without overriding a CommonJS dependency with ESM-only decoder0.5 or downgrading Privy.

## Verification and maintenance

- Clean Node24 `npm ci --ignore-scripts` (ignored local apps/fan-web prototype must not be included in release validation).
- `npm run security:audit:baseline`, `npm run security:verify` and `npm run security:ws-canary`.
- `node --test scripts/security-patch-regression.test.mjs`: Tiptap prototype safety and actual URI round trips for every nested WalletConnect utils copy, including the previously vulnerable Wagmi path.
- Web unit suite (267 files, 1553 tests), production build, typecheck and read-only browser smoke checks are release gates.
- Module/browser checks are not evidence of a real wallet transaction or authenticated production session. No production DB write or wallet transaction is part of these checks.

CI enforces patched minimums, decoder absence, the exact audit allowlist and module regressions. Never raise the baseline merely to pass CI; lower it when accepted advisories disappear.

Remove the WalletConnect override only when upstream consumers independently resolve utils >=2.21.9 and clean-install audit/regression checks pass. Residual UUID owner: ByUs engineering. Next review: 2026-10-01, or immediately on a relevant upstream release/new advisory.

## 2026-09-11 CI failure notification repair

The repeated `Run failed` emails were from GitHub Actions, while the corresponding Vercel Git deployments were READY. The latest failed audit (run `34504829454`, commit `b0d8c4a`) reported Critical 1, High 1, Moderate 11. The existing baseline correctly rejected the new advisories; its thresholds and allowlist remain unchanged.

- Next.js 16.2.12 → 16.3.4, with matching eslint-config-next. Patched minimum 16.3.3 addresses [Windows RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36) and [AVIF image optimization](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4).
- Sharp 0.35.3 → 0.35.4, including the existing Next.js override and native libvips assets, addresses [libheif vulnerabilities](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- baseline-browser-mapping 2.10.43 → 2.11.22 within the existing dependency range addresses [invalid-input process termination](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv); patched minimum 2.11.0.
- The dependency verifier now rejects regressions below those patched versions. Production audit returns **Critical 0, High 0, Moderate 10**, all within the existing tracked UUID baseline.
- The separate `Fan design system` failures came from guest-home tests assuming inactive carousel slides were accessible and an unscoped pause-button query matching both carousels. Tests are aligned with the current carousel interaction without changing product behavior.

Validation: clean Node 24 install, production audit baseline, dependency constraints, WebSocket canary, six editor/wallet regressions, full lint and optimized production build passed. Native sharp PNG → resized WebP conversion passed. The exact Fan design system command passes all 228 tests in 29 files; guest-home passes all 46 tests.

The broader web suite finishes at **2482 passed / 3 failed** (361 files). It has three pre-existing `guest-home-spacing.contract.test.ts` failures (old 24px expectations and a removed Passport heading selector), outside the failing CI workflow. All three reproduce with the exact pre-patch HEAD source and original Next 16.2.12 dependency installation. The suite also depends on gitignored brand source images and release ledgers; these were copied from the original checkout for local verification only. No unrelated CSS changes or test suppression are included in this repair.

Local smoke: home and LIVE render after copying the existing environment file into the isolated checkout; navigation to LIVE succeeds. Initial environment-less HTTP 500s were resolved by local configuration. Login SDK initialization on the local 127.0.0.1 host remains unverified; no authenticated session or production UI mutation was performed.

### Vercel packaging follow-up

The first patched deployment (`dpl_7YztCtZ7um7KDvKx1qXPYdriinAe`) failed at TypeScript resolution of `scripts/local-production-env.mjs` from `server/config/local-production-env.contract.test.ts`. `.vercelignore` omitted the entire root scripts directory; an ordinary local build retained it. Keep the two required helper/declaration files in the deployment while excluding other scripts. For this repository, dependency/compiler or deployment-ignore changes must additionally pass a local build of the `.vercelignore`-filtered tracked files. A normal full-checkout build alone does not cover the deployed file set. This is a packaging check; it does not require repeated production UI QA.

The filtered tracked-file build passed after a fresh Node 24 `npm ci --ignore-scripts`, preserving nested workspace dependencies. Root-only dependency copies are insufficient (the web workspace uses jose 6.1.3 while a root transitive copy is 4.15.9); no Apple authentication source/test change was needed. Normal application tests and security thresholds are unchanged by the packaging follow-up.

## 2026-10-02 dependency audit repair

The existing audit gate correctly rejected newly reported production vulnerabilities. The current production and development audits both return **Critical 0, High 0, Moderate 10**. The baseline thresholds and advisory allowlist are unchanged; the remaining ten effects still belong to the documented UUID advisory above. No cross-major UUID override, SDK downgrade or forced audit fix is included.

- Next.js and eslint-config-next 16.3.4 → 16.3.8 address the [ImageResponse Node.js RCE advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), patched from 16.3.6. ByUs's `/share/default.png` route is force-static and renders a local image with constant values; no attacker-controlled SVG/style input was found in this route. This review does not establish that exploitation occurred.
- The existing Coinbase CDP SDK-scoped Axios override moves 1.18.1 → 1.20.0 within the upstream supported range. [Axios 1.20.0](https://github.com/axios/axios/releases/tag/v1.20.0) includes fixes for prototype-pollution read-side gadgets, denial of service and conditional SSRF/HTTP2 issues. The new regression resolves the actual Coinbase SDK dependency and verifies that an inherited HTTP method cannot change a default GET request. Its custom adapter makes no network request and does not reproduce every Axios advisory.
- Vitest and its workspace companion packages move 4.1.10 → 4.1.11 for [mock redirect path traversal](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). The existing Vite, Rolldown, Chai and related compatible versions are preserved.
- Lockfile-only compatible updates fix development-tool advisories in [brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) (1.1.21 and 5.0.12), [browserslist](https://github.com/advisories/GHSA-73wf-gq98-2v4g) (4.29.3), [js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh) (4.3.2) and [undici](https://github.com/advisories/GHSA-w293-vg96-wgc3) (7.30.0). Required Browserslist data packages update within their existing ranges.
- The dependency verifier rejects earlier Next.js, Axios and Vitest/mocker versions. CI additionally runs the full dependency audit at `--audit-level=high`, covering development tools without accepting any new moderate production exception.
- Six recipient-form tests had a September 30 fixture deadline and depended on the real clock. The test now fixes only Date to September 20, keeping real timers and both open/expired deadline cases. Product deadline behavior is unchanged.
- The fanmeeting inquiry test waits for the overlay's initial animation-frame focus before typing. Its immediate mocked POST response could otherwise race that initial focus; the success-button focus, submitted payload and fresh-form assertions are retained. Product overlay behavior is unchanged.

Clean installation and verification use Node 24.21.0 and npm 11.18.0. The user's global npm allow-scripts configuration is not changed; the clean install uses `env -u npm_config_allow_scripts npm_config_userconfig=/dev/null npm ci --ignore-scripts` to avoid leaking that configuration into a git dependency's preparation process.

Validation: clean install, production baseline audit, full `npm audit --audit-level=high --ignore-scripts`, patched-version constraints, 19 security/build-ignore regressions, WebSocket canary, full lint and typechecks passed. The full web suite passes 554 files / 4,375 tests; worker passes 50 files / 674 tests with one existing skipped file/test. Both the normal production build and the `.vercelignore`-filtered tracked-file build pass. The final filtered build includes the stabilized tests and release note; its package lock matches the clean-install candidate exactly.

Read-only local browser smoke confirms Home at 390/1440 widths with no horizontal overflow or unhandled page errors, plus the actual `/share/default.png` HTTP 200, valid 1200 × 630 PNG and visually correct share card. Dev LIVE fails a `live_events` database read and is not certified by this local smoke. Those product files are unchanged; this evidence alone does not rule out a dependency interaction. The existing production Home and LIVE return HTTP 200 before the patch. The release gate additionally requires exact-commit CI/deployment success and read-only production Home/LIVE/share checks after deployment; it includes no authenticated operation, database write or wallet transaction.

Residual UUID owner remains ByUs engineering. Next review: 2026-11-01, or immediately on a relevant upstream release/new advisory.
