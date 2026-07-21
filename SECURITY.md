# Security dependency policy

Last reviewed: 2026-07-21  
Owner: ByUs engineering (repository maintainers)

## Enforced dependency constraints

- Node.js is fixed to 24.13.1 for lock-file and release verification.
- `@aws-sdk/client-secrets-manager` is pinned to `3.1091.0`; the vulnerable
  `fast-xml-parser` dependency must not be present.
- Axios is pinned to `1.18.1` only below `@coinbase/cdp-sdk`.
- Vulnerable `ws` 8.x releases are overridden to `8.21.1`. Existing 7.x paths
  are intentionally left on their own major version.
- `npm audit fix --force` is prohibited because it proposes breaking
  downgrades of Next.js and Privy.

Run the durable checks with:

```sh
npm run security:verify
npm run security:tree
npm run security:audit
```

## Time-limited accepted risks

### Next.js bundled PostCSS

- Advisory: [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
- Affected path: `next@16.2.10 -> postcss@8.4.31`
- Severity recorded by npm: moderate
- Required attacker capability: provide CSS that the application processes
  with PostCSS and later inserts into a `<style>` context.
- ByUs exposure: no application path accepts raw CSS, selectors, rules, style
  tags, or PostCSS input from users, CMS records, or external URLs. Repository
  controlled CSS is the only production input.
- Compensating controls: no raw CSS ingestion; no `dangerouslySetInnerHTML` or
  runtime stylesheet construction in service code; production builds use
  repository-controlled sources.
- Resolution: track a Next.js release that bundles PostCSS `>=8.5.10`; do not
  override Next.js internals or downgrade Next.js.
- Review date: 2026-08-20 or the next Next.js release, whichever comes first.
- Expiration date: 2026-08-20.
- Owner: ByUs engineering.

### MetaMask transitive UUID

- Advisory: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
- Affected path: `Privy -> x402 -> wagmi -> connectors -> MetaMask -> uuid`
- Severity recorded by npm: moderate
- Required attacker capability: reach UUID v3, v5, or v6 with an
  attacker-controlled output buffer and invalid offset.
- ByUs exposure: service code does not import the npm `uuid` package and does
  not invoke UUID v3, v5, or v6. The only application UUID generation uses
  Node `crypto.randomUUID()` or PostgreSQL `gen_random_uuid()`.
- Compensating controls: Google-only Privy login and Privy embedded wallets;
  no ByUs API forwards request buffers into MetaMask UUID functions.
- Resolution: track upstream MetaMask, Wagmi, and Privy releases. Do not apply
  a global UUID major-version override.
- Review date: 2026-08-20 or the next Privy release, whichever comes first.
- Expiration date: 2026-08-20.
- Owner: ByUs engineering.

## Verification record

On 2026-07-21 under Node.js 24.13.1 and npm 11.18.0:

- clean `npm ci` completed;
- web and Worker type checks passed;
- 164 tracked service tests passed (128 web and 36 Worker); 9 additional tests
  from the local ignored prototype also passed;
- Worker TypeScript and Lambda bundle builds passed;
- Next.js production build passed;
- `fast-xml-parser`, vulnerable Axios, and vulnerable `ws` 8.x paths were absent;
- a `ws@8.21.1` canary completed connect, message, clean close, and reconnect;
- the remaining production audit result was 12 moderate findings, limited to
  the two accepted-risk groups above.
