<p align="center">
  <a href="https://kyaa.io/?locale=en">
    <img src="apps/web/public/images/guest-home/kyaa-wordmark.svg" width="240" alt="kyaa">
  </a>
</p>

<h1 align="center">Kyaa. Every Fan Moment Counts.</h1>

<p align="center">
  kyaa is a fan-commerce platform that connects verified fandom, LIVE participation,
  portable credentials, and real benefits in one consumer journey.
</p>

<p align="center">
  <a href="https://kyaa.io/?locale=en"><img alt="Live product" src="https://img.shields.io/badge/Live_Product-kyaa.io-7B5CFF?style=flat-square"></a>
  <a href="https://github.com/kyaa-io/kyaa-docs"><img alt="Developer docs" src="https://img.shields.io/badge/Developer_Docs-GitBook-FF5CDA?style=flat-square"></a>
  <a href="https://docs.giwa.io/giwa-chain/en/"><img alt="GIWA Sepolia" src="https://img.shields.io/badge/GIWA_Sepolia-91342-17191C?style=flat-square"></a>
  <a href="https://github.com/kyaa-io/kyaa/actions/workflows/dependency-audit.yml"><img alt="Dependency audit" src="https://github.com/kyaa-io/kyaa/actions/workflows/dependency-audit.yml/badge.svg"></a>
</p>

## What kyaa does

Fan activity is valuable, but it is usually fragmented across content, community, LIVE, and commerce platforms. kyaa turns verified participation into a persistent fan record:

1. **Discover** a favorite creator and an upcoming LIVE.
2. **Sign in** with Google while an embedded EVM wallet is provisioned in the background.
3. **Verify** fandom through a creator-specific quiz.
4. **Collect** a soulbound Fan Passport and participation Stamps.
5. **Grow** Fan Score through reservations, attendance, and surveys.
6. **Unlock** benefits based on verified activity—not follower count.

The previews below show the earlier ByUs release; the current product is available at [kyaa.io](https://kyaa.io/?locale=en).

| Discover and participate | Verify and unlock |
| --- | --- |
| <img src=".github/assets/discover.png" alt="ByUs creator and LIVE discovery screen"> | <img src=".github/assets/verify.png" alt="ByUs fan verification screen"> |
| <img src=".github/assets/participate.png" alt="ByUs LIVE participation screen"> | <img src=".github/assets/benefit.png" alt="ByUs benefits screen"> |

## Product architecture

kyaa is database-first. Supabase remains the operational source of truth for identity, activity, score, eligibility, claims, and mint state. GIWA provides the public ownership and verification layer for issued credentials.

```mermaid
flowchart LR
    Fan["Fan"] --> Web["Next.js product<br/>and server-side BFF"]
    Fan --> Privy["Privy<br/>Google sign-in + embedded wallet"]
    Privy --> Web
    Web --> DB["Supabase<br/>identity, activity, score,<br/>benefits, credentials, queues"]
    DB --> Worker["One-shot workers"]
    Worker --> IPFS["IPFS metadata"]
    Worker --> GIWA["GIWA Sepolia<br/>Passport + Stamp"]
    GIWA --> DB
```

### Technology

| Layer | Implementation |
| --- | --- |
| Product | Next.js 16, React 19, TypeScript |
| Identity and wallet | Privy embedded EVM wallet |
| Data and queues | Supabase Postgres, RLS, RPCs, Edge Functions |
| Chain integration | Viem, GIWA Sepolia |
| Credentials | Soulbound ERC-721 Passport and ERC-1155 Stamp |
| Metadata | IPFS |
| Workers | One-shot TypeScript workers on AWS Lambda |
| Contracts | Solidity 0.8.28, Foundry, OpenZeppelin Contracts |

## Fan Passport and Live Stamps

### Fan Passport

Each Passport belongs to one fan in one creator context. It brings together:

- verified fan identity;
- Fan Score and level progress;
- Knowledge, Reservation, Attendance, and Survey Stamps;
- recent participation;
- available benefits;
- GIWA token and transaction proof after minting.

### Live Stamps

| Activity | Credential | Fan Score |
| --- | --- | ---: |
| Pass fan verification | Knowledge Stamp | `+1` |
| Reserve a LIVE | Reservation Stamp | `+1` |
| Enter the LIVE Fan Code | Attendance Stamp | `+3` |
| Complete the post-LIVE survey | Survey Stamp | `+2` |

Both credential contracts are non-transferable. A fan can prove the record, but cannot sell or transfer it to another wallet.

## Verified on GIWA Sepolia

| Credential | Contract | Standard |
| --- | --- | --- |
| Fan Passport | [`0x17f9…ca20`](https://sepolia-explorer.giwa.io/address/0x17f9FB7658A326DD88dB523739c227faf50Fca20) | Soulbound ERC-721 |
| Live Stamp | [`0x1AdC…2285`](https://sepolia-explorer.giwa.io/address/0x1AdCdE3473c4e884E60205b397ecE744D8892285) | Soulbound ERC-1155 |

- [Successful Passport mint](https://sepolia-explorer.giwa.io/tx/0x7574bdeb18ca5ecfcffcbc581cad353e9bfdff69d7f3c792d3add471f54c504e)
- [Successful Stamp mint](https://sepolia-explorer.giwa.io/tx/0x4c3bcf6e47388b30c289bf83c468f67fb2047799b47e31b5181e83c44c5ef627)
- [Standalone contract repository](https://github.com/kyaa-io/kyaa-contracts)

> The current deployment is on GIWA Sepolia testnet. kyaa does not put private fan profiles, quiz answers, activity logs, CRM data, or benefit fulfillment data on-chain. Existing ByUs contracts and issued credentials retain their original names and addresses.

## Repository map

```text
apps/web              Production fan product, BFF, and operations UI
apps/worker           Passport/Stamp minting and notification workers
contracts             Soulbound credential contracts and Foundry tests
supabase/migrations   Product domain, queues, owner projections, and invariants
supabase/functions    Protected scheduler and queue-maintenance functions
infrastructure/aws    Worker runtime infrastructure
scripts               Build, security, media, deployment, and verification tools
```

`apps/web` is the production application.

## Quick start

### Requirements

- Node.js `24.13.1`
- npm `11.18.0`
- Maintainer-approved development values for Privy, Supabase, and GIWA

```bash
git clone https://github.com/kyaa-io/kyaa.git
cd kyaa
npm ci

cp apps/web/.env.example apps/web/.env.local
# Fill apps/web/.env.local with authorized development values.

npm run dev --workspace @byus/web
```

Open [http://localhost:3000](http://localhost:3000).

### Quality checks

```bash
npm run test:web
npm run typecheck
npm run lint:web
npm run build

npm test --workspace @byus/worker
npm run typecheck --workspace @byus/worker
npm run build --workspace @byus/worker

cd contracts
forge test
```

The full environment model, worker lifecycle, and verification commands are documented in the [kyaa Developer Documentation](https://github.com/kyaa-io/kyaa-docs).

## Security and privacy

- Protected product requests are verified by the server-side BFF.
- Browser roles do not receive direct access to private operational tables.
- Passport and Stamp metadata excludes email, nickname, real name, phone number, wallet recipient, and internal entity identifiers.
- Business state is committed before asynchronous minting.
- Mint jobs are leased, idempotent, and reconciled against receipts and contract events.
- Relayer, Supabase service-role, and IPFS credentials belong only in server or worker environments.

Please read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Documentation

- [Pitch deck (PDF)](https://docs.google.com/presentation/d/10a9xoaRKJhAXzbBOguwKFM-wmOPlmRg9gy_EFRr0rss/export/pdf)
- [Developer documentation source](https://github.com/kyaa-io/kyaa-docs)
- [Product journey](https://github.com/kyaa-io/kyaa-docs/blob/main/getting-started/product-journey.md)
- [Architecture overview](https://github.com/kyaa-io/kyaa-docs/blob/main/architecture/overview.md)
- [GIWA network and contracts](https://github.com/kyaa-io/kyaa-docs/blob/main/giwa/network-and-contracts.md)
- [kyaa Contracts](https://github.com/kyaa-io/kyaa-contracts)

## License

The application source is publicly viewable for evaluation and collaboration. Copyright © 2026 SallyLab Inc. All rights reserved. See [LICENSE](LICENSE).
