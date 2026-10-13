# kyaa credential migration

The reviewed [GIWA plan](deployments/2026-10-13-kyaa-binding-2-plan.json) deploys new Passport/Stamp contracts and a compatible implementation of the existing ActionHub. It **does not activate new issuance**. Binding 1, old NFT metadata and signed/queued requests retain their original meaning. Binding 2 is reserved for new requests after the separate, verified route switch.

Compiler: Solidity 0.8.28, optimizer runs 0, via IR. `KyaaPassport` is `kyaa Fan Passport` / `KYAAPASS`; `KyaaStamp` retains the existing ERC-1155 ABI. Both use the existing Timelock as administrator and the existing Hub as minter. No Collectible is enabled by this migration.

`scripts/migrate-kyaa-giwa.mjs` supports `prepare`, `deploy-and-schedule`, `inspect`, and `execute-upgrade`. Pass `--manifest` and, for mutations, the exact reviewed `--approved-hash`. It reconstructs the artifact-bound plan, validates the signer/chain/nonce/fees, journals the signed envelope before transmission, and refuses to re-sign an RPC-unknown transaction. The operator uses the existing local Keychain signer; signed journals remain outside tracked files in shared Git metadata.

The live Timelock delay is 172800 seconds. Record its actual operation timestamp after scheduling. Execute only when that exact operation is ready, then verify both bindings, deployment source, runtime and privileges. An already successful binding-2 issuance must never be rolled back to a v1-only implementation or reissued against an old contract.

Before switching producer routes:

1. Deploy the compatible worker and public snapshot reader; apply `20261013110000_kyaa_credential_cutover.sql` (which activates no route).
2. Finish all previous LIVE registration manifests/journals. Register missing public contexts with their actual published UUID/slug and verify them at one canonical finalized block.
3. Insert binding `f03415d0-3235-4bd7-bee5-a8a9c36c163a` and its freshly verified creator/campaign proofs; publish the verified binding-2 asset allowlist. Keep the legacy direct worker addresses.
4. Set `mint_dispatch_policy.transmission_paused=true` as DB owner. Receipt processing stays on. Wait the actual Lambda Timeout for prior invocations and confirm no live chain-writer leases.
5. Lock and recheck the 10 enabled routes, empty canary scope, current public context coverage and verified contracts; switch routes atomically. Preserve all queued payloads and snapshots. Unpause and verify new issuance, old issuance lookup, duplicate source replay and mixed public counts using the designated QA actor.

For recovery, pause transmission and repeat the invocation/lease barrier while continuing receipt reconciliation. Preserve successful transactions and signed payloads. Correct the compatible path; never blanket-rewrite queue bindings or blindly reissue assets.

## Scheduled on 2026-10-13

All three deployments are confirmed in the [public receipts](deployments/2026-10-13-kyaa-binding-2-plan.json.receipts.json). The existing Timelock scheduled operation `0x736e5ad8a93b2b7644ab87ee5a54aaab48606e9b6e1dfa804c12e14b7fdf105d` in transaction `0x79f12169a541258d5129e0a3cdf244033179cc929cca3efbad06577b53a500f6`. Earliest execution is **2026-10-15 11:28:20 UTC / 20:28:20 KST**. Scheduling did not upgrade the Hub or activate binding-2 producer routes.
