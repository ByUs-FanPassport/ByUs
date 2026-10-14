// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ByUsPassport } from "./ByUsPassport.sol";
import { ByUsStamp } from "./ByUsStamp.sol";
import { ByUsActionHub } from "./ByUsActionHub.sol";
import { IEAS } from "./interfaces/IEAS.sol";

/// @notice Same-wallet, key-preserving replacements; never changes Hub actions or old credentials.
contract KyaaCredentialMigrator is ReentrancyGuard {
    error Unauthorized();
    error InvalidBatch();
    error BatchUnavailable();
    error BatchLimit();
    error InvalidProof();
    error AssetMismatch();
    error AlreadyMapped();
    error InvalidSourceAction();

    struct Item {
        bytes32 batchId;
        uint8 kind;
        uint256 oldTokenId;
        bytes32 issuanceKey;
        address recipient;
        bytes32 oldUriHash;
        bytes32 newUriHash;
        address sourceHub;
        bytes32 sourceActionId;
    }

    struct Batch {
        bytes32 root;
        bytes32 manifestHash;
        uint64 expiresAt;
        uint32 maxItems;
        uint32 maxMints;
        uint32 itemsUsed;
        uint32 mintsUsed;
        bool closed;
    }

    struct Replacement {
        bytes32 leaf;
        bytes32 batchId;
        uint256 tokenId;
        address recipient;
        bytes32 metadataHash;
        address sourceHub;
        bytes32 sourceActionId;
        bool minted;
    }

    struct EasData {
        bytes32 occurrenceId;
        bytes32 actionId;
        uint32 revision;
        uint16 actionCode;
        uint16 schemaVersion;
        uint32 policyVersion;
        bytes32 environment;
        bytes32 creatorId;
        bytes32 campaignId;
        uint32 occurredDay;
        uint8 origin;
        bytes32 evidenceCommitment;
        bytes32 refsHash;
        bytes32 migrationBatchId;
    }

    address public immutable timelock;
    address public immutable operator;
    ByUsActionHub public immutable hub;
    ByUsActionHub public immutable legacyHub;
    bytes32 public immutable environmentId;
    address public immutable oldPassport;
    address public immutable oldStamp;
    address public immutable newPassport;
    address public immutable newStamp;
    bool public paused;
    mapping(bytes32 => Batch) public batches;
    mapping(bytes32 => Replacement) public replacements;
    mapping(bytes32 => bytes32) public sourceByTarget;

    event BatchRegistered(
        bytes32 indexed batchId,
        bytes32 root,
        bytes32 manifestHash,
        uint32 maxItems,
        uint32 maxMints,
        uint64 expiresAt
    );
    event BatchClosed(bytes32 indexed batchId);
    event PauseChanged(bool paused);
    event CredentialReplaced(
        bytes32 indexed batchId,
        address indexed oldContract,
        uint256 indexed oldTokenId,
        address newContract,
        uint256 newTokenId,
        address recipient,
        bytes32 issuanceKey,
        bytes32 metadataHash,
        address sourceHub,
        bytes32 sourceActionId,
        bytes32 leaf,
        bool minted
    );

    constructor(
        address timelock_,
        address operator_,
        address hub_,
        address legacyHub_,
        address oldPassport_,
        address oldStamp_,
        address newPassport_,
        address newStamp_
    ) {
        if (
            timelock_ == address(0) || operator_ == address(0) || operator_ == timelock_
                || oldPassport_.code.length == 0 || oldStamp_.code.length == 0
                || newPassport_.code.length == 0 || newStamp_.code.length == 0
                || oldPassport_ == newPassport_ || oldStamp_ == newStamp_
        ) revert AssetMismatch();
        timelock = timelock_;
        operator = operator_;
        hub = ByUsActionHub(hub_);
        legacyHub = ByUsActionHub(legacyHub_);
        environmentId = ByUsActionHub(hub_).environmentId();
        if (environmentId == bytes32(0) || legacyHub.environmentId() != environmentId) {
            revert InvalidSourceAction();
        }
        oldPassport = oldPassport_;
        oldStamp = oldStamp_;
        newPassport = newPassport_;
        newStamp = newStamp_;
    }

    function registerBatch(
        bytes32 batchId,
        bytes32 root,
        bytes32 manifestHash,
        uint32 maxItems,
        uint32 maxMints,
        uint64 expiresAt
    ) external {
        if (msg.sender != timelock) revert Unauthorized();
        if (
            batchId == bytes32(0) || root == bytes32(0) || manifestHash == bytes32(0)
                || batches[batchId].root != bytes32(0) || maxItems == 0 || maxItems > 10_000
                || maxMints > maxItems || expiresAt <= block.timestamp
                || expiresAt > block.timestamp + 90 days
        ) revert InvalidBatch();
        batches[batchId] = Batch(root, manifestHash, expiresAt, maxItems, maxMints, 0, 0, false);
        emit BatchRegistered(batchId, root, manifestHash, maxItems, maxMints, expiresAt);
    }

    function closeBatch(bytes32 batchId) external {
        if (msg.sender != timelock && msg.sender != operator) revert Unauthorized();
        if (batches[batchId].root == bytes32(0)) revert InvalidBatch();
        batches[batchId].closed = true;
        emit BatchClosed(batchId);
    }

    function pause() external {
        if (msg.sender != timelock && msg.sender != operator) revert Unauthorized();
        paused = true;
        emit PauseChanged(true);
    }

    function unpause() external {
        if (msg.sender != timelock) revert Unauthorized();
        paused = false;
        emit PauseChanged(false);
    }

    function assetIdentity(address nft, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(nft, tokenId));
    }

    function leafHash(Item memory item) public view returns (bytes32) {
        (address source, address target) = _contracts(item.kind);
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(this), environmentId, source, target, item)
                )
            )
        );
    }

    function migrate(
        Item calldata item,
        string calldata metadataUri,
        bytes32[] calldata proof,
        ByUsActionHub.CredentialRef[] calldata sourceRefs
    ) external nonReentrant returns (uint256 tokenId) {
        if (msg.sender != operator) revert Unauthorized();
        Batch storage batch = batches[item.batchId];
        if (paused || batch.root == bytes32(0) || batch.closed || block.timestamp > batch.expiresAt)
        {
            revert BatchUnavailable();
        }
        bytes32 leaf = leafHash(item);
        if (!MerkleProof.verifyCalldata(proof, batch.root, leaf)) revert InvalidProof();
        if (
            item.recipient == address(0) || item.oldTokenId == 0 || item.issuanceKey == bytes32(0)
                || bytes(metadataUri).length == 0 || bytes(metadataUri).length > 2048
                || keccak256(bytes(metadataUri)) != item.newUriHash
        ) revert AssetMismatch();
        (address source, address target) = _contracts(item.kind);
        _validateAsset(
            source, item.kind, item.oldTokenId, item.issuanceKey, item.recipient, item.oldUriHash
        );
        _validateSourceAction(item, source, sourceRefs);
        bytes32 sourceId = assetIdentity(source, item.oldTokenId);
        Replacement storage previous = replacements[sourceId];
        if (previous.tokenId != 0) {
            if (previous.leaf != leaf) revert AlreadyMapped();
            _validateAsset(
                target,
                item.kind,
                previous.tokenId,
                item.issuanceKey,
                item.recipient,
                item.newUriHash
            );
            return previous.tokenId;
        }
        if (batch.itemsUsed >= batch.maxItems) revert BatchLimit();
        tokenId = item.kind == 0
            ? ByUsPassport(target).tokenByPassportId(item.issuanceKey)
            : ByUsStamp(target).tokenByIssuanceId(item.issuanceKey);
        bool minted = tokenId == 0;
        batch.itemsUsed++;
        if (minted) {
            if (batch.mintsUsed >= batch.maxMints) revert BatchLimit();
            batch.mintsUsed++;
            tokenId = item.kind == 0
                ? ByUsPassport(target).mint(item.recipient, item.issuanceKey, metadataUri)
                : ByUsStamp(target).mint(item.recipient, item.issuanceKey, metadataUri);
        }
        _validateAsset(
            target, item.kind, tokenId, item.issuanceKey, item.recipient, item.newUriHash
        );
        bytes32 targetId = assetIdentity(target, tokenId);
        if (sourceByTarget[targetId] != bytes32(0)) revert AlreadyMapped();
        sourceByTarget[targetId] = sourceId;
        replacements[sourceId] = Replacement(
            leaf,
            item.batchId,
            tokenId,
            item.recipient,
            item.newUriHash,
            item.sourceHub,
            item.sourceActionId,
            minted
        );
        emit CredentialReplaced(
            item.batchId,
            source,
            item.oldTokenId,
            target,
            tokenId,
            item.recipient,
            item.issuanceKey,
            item.newUriHash,
            item.sourceHub,
            item.sourceActionId,
            leaf,
            minted
        );
    }

    function _contracts(uint8 kind) internal view returns (address source, address target) {
        if (kind > 1) revert AssetMismatch();
        return kind == 0 ? (oldPassport, newPassport) : (oldStamp, newStamp);
    }

    function _validateAsset(
        address nft,
        uint8 kind,
        uint256 tokenId,
        bytes32 key,
        address owner,
        bytes32 uriHash
    ) internal view {
        if (kind == 0) {
            ByUsPassport passport = ByUsPassport(nft);
            if (
                passport.tokenByPassportId(key) != tokenId || passport.ownerOf(tokenId) != owner
                    || keccak256(bytes(passport.tokenURI(tokenId))) != uriHash
            ) revert AssetMismatch();
        } else {
            ByUsStamp stamp = ByUsStamp(nft);
            if (
                stamp.tokenByIssuanceId(key) != tokenId || stamp.balanceOf(owner, tokenId) != 1
                    || stamp.totalSupply(tokenId) != 1
                    || keccak256(bytes(stamp.uri(tokenId))) != uriHash
            ) revert AssetMismatch();
        }
    }

    function _validateSourceAction(
        Item calldata item,
        address source,
        ByUsActionHub.CredentialRef[] calldata refs
    ) internal view {
        if (item.sourceActionId == bytes32(0)) {
            if (refs.length != 0 || item.sourceHub != address(0)) {
                revert InvalidSourceAction();
            }
            return; // Legacy validity is checked by the restricted operator against the approved DB inventory.
        }
        if (item.sourceHub != address(hub) && item.sourceHub != address(legacyHub)) {
            revert InvalidSourceAction();
        }
        ByUsActionHub sourceHub = ByUsActionHub(item.sourceHub);
        ByUsActionHub.ActionRecord memory record = sourceHub.getAction(item.sourceActionId);
        if (
            record.actionId != item.sourceActionId
                || record.status != ByUsActionHub.ActionStatus.ACTIVE
                || record.fan != item.recipient
                || sourceHub.latestActionId(record.occurrenceId) != item.sourceActionId
                || sourceHub.environmentId() != environmentId
        ) revert InvalidSourceAction();
        IEAS eas = IEAS(sourceHub.eas());
        IEAS.Attestation memory attestation = eas.getAttestation(record.easUID);
        if (
            !eas.isAttestationValid(record.easUID) || attestation.uid != record.easUID
                || attestation.schema != record.schemaUID || attestation.attester != item.sourceHub
                || attestation.recipient != item.recipient || attestation.refUID != record.refUID
                || attestation.revocationTime != 0
                || (attestation.expirationTime != 0
                    && attestation.expirationTime <= block.timestamp)
                || attestation.data.length != 14 * 32
                || keccak256(attestation.data) != record.recordHash
        ) revert InvalidSourceAction();
        EasData memory data = abi.decode(attestation.data, (EasData));
        if (
            data.actionId != item.sourceActionId || data.occurrenceId != record.occurrenceId
                || data.environment != environmentId || data.refsHash != keccak256(abi.encode(refs))
        ) revert InvalidSourceAction();
        bool found;
        for (uint256 i; i < refs.length; ++i) {
            if (
                refs[i].nftContract == source && refs[i].tokenId == item.oldTokenId
                    && uint8(refs[i].kind) == item.kind && refs[i].issuanceKey == item.issuanceKey
            ) found = true;
        }
        if (!found) revert InvalidSourceAction();
    }
}
