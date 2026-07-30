# Security Policy

Security and fan privacy are part of the ByUs product boundary. Please report potential vulnerabilities privately and allow the maintainers time to investigate before any public disclosure.

## Supported version

Security fixes are applied to the current `main` branch and the production version deployed from it.

## Report a vulnerability

Use the repository's [private vulnerability reporting form](https://github.com/ByUs-FanPassport/ByUs/security/advisories/new).

Do not open a public issue for a suspected vulnerability. Include:

- the affected component and route;
- reproduction steps or a proof of concept;
- the expected and observed result;
- the potential security or privacy impact;
- any suggested mitigation;
- a safe way to contact you for follow-up.

Do not include real fan personal data, production credentials, private keys, session tokens, or destructive payloads in the report.

## Response process

The maintainers will:

1. acknowledge the report;
2. reproduce and assess the issue;
3. coordinate a fix and validation plan;
4. agree on a disclosure timeline with the reporter when appropriate.

## Security boundaries

- Browser sessions are authenticated with Privy and verified again by the server-side BFF.
- Private Supabase tables and owner-scoped projections are accessed server-side.
- Passport and Stamp metadata deliberately excludes fan PII.
- Relayer, Supabase service-role, and IPFS credentials are restricted to server or worker environments.
- Credential minting is database-first, asynchronous, leased, and idempotent.
- Both credential contracts are soulbound and use separate mint, pause, and delayed admin controls.

For the public architecture and privacy model, see the [ByUs Developer Documentation](https://github.com/ByUs-FanPassport/ByUs---GitBook).
