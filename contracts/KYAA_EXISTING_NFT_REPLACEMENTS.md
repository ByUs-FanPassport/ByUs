# Existing kyaa credential replacements

This is separate from the [binding-2 Hub upgrade](KYAA_MIGRATION.md). Each verified old asset receives one same-wallet, same-issuance-key representative on the new Passport/Stamp contract. Old tokens, Hub actions, EAS attestations, dates, points and rewards remain unchanged. Old tokens remain visible in external wallets.

The immutable `KyaaCredentialMigrator` accepts only an operator-submitted Merkle proof against a Timelock-registered batch. Each leaf binds the chain, migrator, environment, old/new contract, old token/key/owner/URI, new URI and original Hub action. It verifies original ownership and current source validity, forbids duplicate source/target mappings, and enforces batch count, mint count, expiry and pause controls. Pure legacy mints have no invented Hub action. Invalid, revoked, ambiguous and unresolved assets are held.

## Scheduled batch

[Public deployment and schedule receipts](deployments/2026-10-14-kyaa-existing-nft-schedule.json) record the deployed migrator `0xd72c1ac7f0ec0fcfe596050cff21f6fb477cee0c`, its batch and operation. Earliest execution is **2026-10-16 01:29:46 UTC / 10:29:46 KST**. The batch covers 1,723 verified assets from finalized block 38593218. Another 25 onchain assets are held; old pending jobs require a later catch-up inventory. Scheduling grants no role immediately and mints no replacement.

Private inventories, owner lists, proofs and signed transaction journals are never committed. The operational handoff in the original checkout records their exact local paths. Publish only aggregate counts, contract addresses, batch hashes and receipts. The 97 replacement metadata documents and 15 image assets are content-addressed; metadata contains no account IDs or wallet addresses.

## Execution and recovery

1. Deploy the compatible web reader before applying `20261014020000_kyaa_existing_credential_replacements.sql`. The old web schemas reject the added mint fields; the new reader accepts the old DB response. Applying the migration creates no replacement mapping and changes no issuance route.
2. Compile the reviewed contracts. Run `scripts/replace-existing-nfts-giwa.mjs inspect --manifest <private-plan> --rpc-file <private-rpc-file>` and verify the exact review hash, deployed runtime/immutables, operation and readiness.
3. At readiness, use `activate` with those arguments and `--approved-hash <review-hash>`. It executes the exact scheduled role grants and root registration, then verifies the roles and batch. Never replace or reschedule an unknown transaction.
4. Start `migrate` with the same arguments, `--database-env <private-env-file>` and `--limit 1`. It rechecks the current original DB reference, wallet, eligibility and aliases, broadcasts once, then persists the mined receipt. It does **not** publish a DB mapping before finality.
5. After the receipt is finalized, run `reconcile` with the same arguments. It verifies the canonical event, forward/reverse mappings, target key/owner/supply/URI and finalized block hash, then atomically appends the mapping and aliases. Check the first representative in its owner's web flow, the public source record and an external wallet before continuing in bounded batches (`--limit 100`). Run `reconcile` after each batch reaches finality.
6. Repeat `migrate` and `reconcile` using the same manifest and journal. Mined entries are skipped by `migrate`; reconciled entries are skipped by both. Signed-only entries are recovered through their existing hash; unknown broadcast results stop without re-signing. A DB failure after mint is repaired by `reconcile`, never by issuing a second token.
7. Re-inventory after the old issuance backlog drains. Explain every held asset and create a separately reviewed, Timelock-authorized catch-up batch for newly eligible assets. Do not edit the registered manifest/root or silently omit held assets.

The signer lock is shared across checkouts in Git metadata. Preserve it and the signed journal on uncertain transmission; investigate before resuming. The script caps fees and gas, bounds each run to 100 entries, and requires the exact reconstructed manifest hash. A failure stops the run. Finalized DB rows are append-only, RLS-protected and unavailable to browser/service-role direct writes. Native source validity is rechecked by the trusted public snapshot before owner responses use a replacement; unavailable proof falls back to the original reference.

## Verification

Focused contract tests cover authorization, Merkle/owner/URI boundaries, duplicate/replay behavior, revoked sources and ERC-721 callback reentrancy. A private pinned GIWA fork at block 38593218 exercises legacy Passport, current-Hub Stamp and legacy-Hub Stamp replacements while preserving original ownership, metadata and Hub/EAS records. Run it with `RUN_KYAA_REPLACEMENT_FORK=true`, `KYAA_REPLACEMENT_FORK_RPC` and the private ABI-encoded `KYAA_REPLACEMENT_FORK_SAMPLES`; without those inputs it deliberately skips.

Node tests cover inventory/alias deduplication, held assets, manifest reconstruction, Merkle proofs, runtime eligibility, bounded recovery and finality. SQL checks replay the full migration chain and exercise append-only ownership projections, alias reconciliation, membership withdrawal and duplicate reconciliation. Web tests verify canonical replacement proofs, current source continuity, original-reference fallback and unchanged counts. Actual 390px/1440px local fixture screenshots cover the unified web artwork; real replacement-wallet QA remains required after activation.
