# Collectible chain binding

- Status: Approved — Alternative B
- Date: 2026-09-04 KST
- Scope: Phase 3 Digital Collectible on GIWA Sepolia (`chainId=91342`)
- Business operation (frozen): `byus:collectible:v1:{claim_id}`
- Production: out of scope; this record authorizes no deployment by itself

## Decision drivers

The business record is one immutable Collectible claim per fan and LIVE, created only from a completed Journey. Supply is unlimited across claims, but every claim is individually unique. The business claim and its blockchain job commit atomically; settlement is asynchronous. A claim grants no Ticket or Score.

The chain binding must provide:

1. a deterministic uniqueness lookup for the claim;
2. a Collectible-specific mint event and wallet-visible token identity;
3. stable ownership/history for later qualification without using a product event row;
4. deterministic transaction preparation, replay, receipt decoding, and reconciliation;
5. a safe Dev-only rollout and explicit recovery path.

The token-neutral business input remains:

```ts
export type CollectibleOperationV1 = {
  operationKey: `byus:collectible:v1:${string}`;
  claimId: string;
  recipient: `0x${string}`;
  metadataVersion: 1;
};
```

`claimId` is the canonical lowercase UUID stored in `collectible_claims.id`. A chain adapter may derive `claimKey = keccak256(utf8(claimId))`; the database operation key and business identity do not change with the token standard.

## Current evidence

Evidence was collected read-only from commit candidate `866bf5342184222f770fe1a3512ab124eaba064e`.

### Source and test evidence

```text
forge test -vv
6 passed; 0 failed; 0 skipped
captured stdout sha256: 641db6555dfde402b17eabea24a75b4bd327c5e07a2e4b78b9c23c72b4470a24
```

Inspected-file SHA-256 values:

| File | SHA-256 |
|---|---|
| `contracts/src/ByUsPassport.sol` | `58bf4ae8e40396aae9fe79a3ae174d38aa3e11eab1330997cb99686a0d24576a` |
| `contracts/src/ByUsStamp.sol` | `110e3c632c7da2bc9d93afe84fb1b66e1ca70223d5d561ce0c47ee2a7c24d1b5` |
| `contracts/script/DeployByUs.s.sol` | `5826bcc61f986cee025ab804ab264187db99c0f87de1e7f1faadfac13fa4a8ae` |
| `contracts/test/ByUsCredentials.t.sol` | `899c4d053027183bf0e114156ac9e1fd156117e131adee059e113d8129f0cd9d` |
| `apps/worker/src/adapters/viem-chain.ts` | `de74a2679316d0e6942c25c87242439ce6ff87d2a9ca9a9601f74243f236c9da` |
| `apps/worker/src/domain.ts` | `8d3f6a513e0300fc867c012617acadddbe39aabc8e779e5bf6a0190fa0f77b98` |
| `apps/worker/src/env.ts` | `64714a80b1980b9ba3f9b2c8d19d01e677d8bb0f0ce4bd7546dfe5cea71c528f` |
| `apps/worker/src/runtime.ts` | `60535b2fd32620dd9965e54e864496ba4e5a5785924846eef96ca0d974234eb2` |
| `apps/worker/src/metadata.ts` | `18e2144dfab482321887a1d64644c9ca1a84799f0572f512a6791891d5d65cec` |

The current worker has only `passport | stamp | reaction`. It sends every non-Passport entity to `ByUsStamp`, looks up `tokenByIssuanceId`, and decodes `StampMinted`. A Collectible must therefore receive an explicit worker branch whichever alternative is selected.

### GIWA Sepolia evidence

Read-only RPC and explorer queries on 2026-09-04 KST established:

| Fact | Passport | Stamp |
|---|---|---|
| Address | `0x17f9FB7658A326DD88dB523739c227faf50Fca20` | `0x1AdCdE3473c4e884E60205b397ecE744D8892285` |
| Standard | ERC-721 | ERC-1155 |
| Verified name | `ByUsPassport` | `ByUsStamp` |
| Runtime bytecode Keccak-256 | `0xa43ffbcc369ad26df22a1094632438d780f976579e07aa5749ea03df3199b1da` | `0x83192d2c4a2e4da60d9cd35e7a58d7ad61df97b7afc0d9592fb015c033400f07` |
| Current source runtime match | yes | yes |
| Creation transaction | `0xed05fe63e0e7a68f556f908a2cfa59f67bd4d48c65ad7ce4c7da3ad57e679689` | `0x817130af51218431d2dc913f96a0d939d0aea62ea30339d2c5771d034d100190` |
| Creation block | `31213597` | `31213597` |
| Creator / configured minter | `0x6b411F5afc240680bB32dF1b30bE07692D5032b4` | same |
| Default admin | `0xeEE82f960476c888950C798C444c1FD92CBbFE50` | same |
| Admin delay | 172800 seconds | 172800 seconds |
| Paused | false | false |

The verified contracts were compiled with Solidity `0.8.28`, optimizer 200 runs, EVM `prague`. Their constructor arguments match the configured admin and relayer. RPC bytecode was read at stable block `35107000` and exactly matched `forge inspect <contract> deployedBytecode`.

Evidence locators:

- [Passport explorer](https://sepolia-explorer.giwa.io/address/0x17f9FB7658A326DD88dB523739c227faf50Fca20)
- [Stamp explorer](https://sepolia-explorer.giwa.io/address/0x1AdCdE3473c4e884E60205b397ecE744D8892285)
- source files and hashes above

## Alternative A — reuse deployed `ByUsStamp`

### Executable binding

- Standard/address: soulbound ERC-1155 at `0x1AdCdE3473c4e884E60205b397ecE744D8892285`.
- ABI: `mint(address to, bytes32 issuanceId, string metadataUri) returns (uint256 tokenId)`.
- Uniqueness: pass `claimKey` as `issuanceId`; query `tokenByIssuanceId(claimKey)`.
- Event: `StampMinted(bytes32 indexed issuanceId, uint256 indexed tokenId, address indexed to, string metadataUri)`.
- Ownership: `balanceOf(recipient, tokenId) == 1`; transfer and approval are blocked.
- Metadata: worker renders a Collectible document and supplies its immutable IPFS URI, even though the verified contract and event remain Stamp-named.
- Configuration: reuse `BYUS_STAMP_CONTRACT_ADDRESS`; no new address or deployment block.
- Migration: add `collectible` to `blockchain_jobs.entity_type`, add claim/job linkage and reconciliation, but no contract deployment.
- Worker: add an explicit `entityType === "collectible"` branch that deliberately points to the Stamp ABI/address; never rely on the current non-Passport fallback.
- Replay: `tokenByIssuanceId(claimKey)` then filter `StampMinted` from block `31213597`; prepared signed bytes remain stored once and rebroadcast unchanged.
- Rollback/reconciliation: disable Collectible job claims; existing mints remain immutable Stamp tokens. Reconcile token ID and transaction from the mapping and event. A later dedicated contract would require a v2 binding and must preserve the historical Stamp address per receipt.

### Assessment

This is operationally cheap, and the generic issuance mapping can enforce uniqueness. It fails the truthfulness gate: the verified contract is `ByUsStamp`, the only domain event is `StampMinted`, and wallets/explorers group the asset under an ERC-1155 Stamp contract. Metadata cannot repair the contract- and event-level mislabeling. Reuse would also make future qualification depend on a convention that distinguishes Collectibles from Stamps off-chain. **Not recommended.**

## Alternative B — dedicated `ByUsCollectible` (recommended)

### Executable binding

- Standard: soulbound ERC-721, one unique token per business claim; unlimited sequential claims globally.
- Name/symbol: `ByUs Digital Collectible` / `BYUSCOLL`.
- Deployment: new non-proxy `ByUsCollectible` on GIWA Sepolia, deployed by a dedicated `DeployByUsCollectible.s.sol` only after this decision is approved. Constructor receives the existing admin `0xeEE82f960476c888950C798C444c1FD92CBbFE50` and relayer/minter `0x6b411F5afc240680bB32dF1b30bE07692D5032b4`.
- ABI:

```solidity
function mint(address to, bytes32 claimKey, string calldata metadataUri)
  external returns (uint256 tokenId);
function tokenByClaimId(bytes32 claimKey) external view returns (uint256 tokenId);
function ownerOf(uint256 tokenId) external view returns (address owner);
function tokenURI(uint256 tokenId) external view returns (string memory);
event CollectibleMinted(
  bytes32 indexed claimKey,
  uint256 indexed tokenId,
  address indexed to,
  string metadataUri
);
```

- Contract rules: reject zero `claimKey`; reject a second mint for a populated `tokenByClaimId`; grant `MINTER_ROLE` only to the relayer; grant `PAUSER_ROLE` to admin; block approvals and all non-mint transfers. No burn in v1.
- Uniqueness: `claimKey = keccak256(utf8(canonicalLowercaseClaimUuid))`; query `tokenByClaimId(claimKey)`.
- Ownership/history: `ownerOf(tokenId)` is stable because the token is soulbound; qualification can join the owned claim row to its chain receipt/token ID and verify current ownership without reading a product event row. `CollectibleMinted` remains auditable chain evidence, not business eligibility truth.
- Metadata: immutable IPFS document named `ByUs Digital Collectible`, containing only public LIVE/Creator slugs, credential kind, soulbound status, and metadata version; no user ID, wallet, Journey answers, or private fan data.
- Configuration: add required worker variables `BYUS_COLLECTIBLE_CONTRACT_ADDRESS` and `GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK`. Production remains unset and unchanged. Dev values are written only after a verified deployment.
- Migration: add `collectible` to `blockchain_jobs.entity_type`; create `collectible_claims`; atomically insert one claim and one job; extend linked-job immutability and reconciliation; no address is stored in business tables. Persist transaction hash/token ID after canonical worker settlement.
- Worker: add `collectiblePayloadV1Schema` with canonical UUID `claimId`, recipient, public LIVE/Creator slugs, `metadataVersion: 1`, and optional prepared submission. Add an explicit Collectible ABI/address branch for lookup, preparation, receipt decode, and reconciliation.
- Replay: derive the same `claimKey` from the immutable payload; first call `tokenByClaimId`; if present, locate `CollectibleMinted` from `GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK`; otherwise prepare once, atomically persist `workerSubmission.txHash` and signed bytes, and rebroadcast the exact bytes on retry.
- Receipt: accept only a successful receipt containing `CollectibleMinted` from the configured Collectible address with the expected `claimKey`, recipient, metadata URI, and token ID. A successful unrelated mint event is not completion.
- Rollback before mint: pause the contract or disable the Dev worker, restore previous worker config/code, and leave queued jobs retryable.
- Recovery after mint: never rewrite a completed receipt or operation key. Reconcile from `tokenByClaimId`, `ownerOf`, `tokenURI`, and the mint event. If the contract is defective, pause it and introduce an explicitly reviewed v2 address/payload; retain the v1 address and deployment block for historical reads. No cross-contract remint is automatic.

### Assessment

This adds one deployment and two worker configuration values, but it makes ABI, event, explorer identity, wallet collection, uniqueness, and ownership semantics agree with the product. ERC-721 fits one individually unique claim; “unlimited” means no campaign-wide supply cap, not fungibility. Soulbound ownership keeps the claimant-to-token qualification stable and matches the existing ByUs credential safety model. **Recommended.**

## Comparison

| Criterion | A: reuse Stamp | B: dedicated Collectible |
|---|---|---|
| Unique per claim | yes | yes |
| Collectible-specific ABI/event | no | yes |
| Truthful wallet/explorer grouping | no | yes |
| Stable ownership lookup | convention-based `balanceOf` | direct `ownerOf` |
| New Dev deployment | no | yes |
| Historical reconciliation | possible, Stamp-labeled | direct, Collectible-labeled |
| Meets all decision drivers | no | yes |

## Approved selection

Select **Alternative B: dedicated soulbound ERC-721 `ByUsCollectible`**. Alternative A is closed and is not a fallback binding for v1.

Accepted costs and risks:

1. one new audited Dev deployment and address/deployment-block configuration;
2. another ABI branch in the worker;
3. v1 tokens cannot be transferred or burned, so a defective deployed version must be paused and superseded rather than edited;
4. wallet indexing on a testnet may lag, so chain RPC receipt/mapping/ownership evidence remains the release proof.

## GPT decision gate

- Chat: `2026-09-04 | Phase 3 Journey 완료 및 Collectible 체인 설계`
- Response locator: [ByUs-Meriq conversation `6a99a20c-5f54-83ee-8ef3-dfc365ef766c`](https://chatgpt.com/g/g-p-6a5739a7f854819186d750931c766c47-byus-meriq/c/6a99a20c-5f54-83ee-8ef3-dfc365ef766c)
- Selection: **APPROVE Alternative B; reject Alternative A**
- Approval: “APPROVED: Alternative B — dedicated soulbound ERC-721 ByUsCollectible — is authorized as the design decision gate, and this approval authorizes no contract implementation, worker implementation, or chain deployment.”
- Accepted risks: one additional audited Dev contract/deployment; dedicated worker/config surface; irreversible erroneous-recipient or defective-contract mints because v1 has no transfer/burn; testnet wallet/explorer indexing lag.
- Disagreements resolved: none remain.

GPT required two executable clarifications, both accepted:

1. token IDs start at `1` because `tokenByClaimId(claimKey) == 0` is the absence sentinel;
2. `BYUS_COLLECTIBLE_CONTRACT_ADDRESS` and `GIWA_COLLECTIBLE_DEPLOYMENT_BLOCK` are required only when the Collectible-enabled Dev branch is active, so an unchanged Production worker remains valid and untouched. A v2 configuration must not destroy v1 historical reconciliation.

The decision gate is now closed. This approval selects the implementation contract but does not itself deploy or mutate any chain.
