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
