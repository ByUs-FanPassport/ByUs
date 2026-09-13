// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IEAS } from "./interfaces/IEAS.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { IByUsPassport, IByUsStamp, IByUsCollectible } from "./interfaces/IByUsCredential.sol";

interface IByUsActionHubConfig {
    function environmentId() external view returns (bytes32);
    function getSchema(uint16 schemaVersion) external view returns (bytes32);
    function getAssetBinding(uint32 bindingVersion, uint8 kind) external view returns (address);
}

/// @dev Stateless, code-hash-pinned helpers kept outside the EIP-170-limited Hub implementation.
contract ByUsActionCodec {
    bytes32 public constant PROTOCOL_ID = keccak256("BYUS_ACTION_CODEC_V1");
    error InvalidCredentialIntent();
    error ExistingCredentialMismatch();

    event FanActionRecorded(
        bytes32 indexed actionId,
        address indexed fan,
        bytes32 indexed campaignId,
        bytes32 occurrenceId,
        uint32 revision,
        bytes32 creatorId,
        string actionName,
        uint16 schemaVersion,
        uint32 policyVersion,
        bytes32 easUID,
        uint32 occurredDay,
        uint8 origin,
        bytes32 migrationBatchId
    );

    struct ActionRequest {
        bytes32 sourceOccurrence;
        uint32 revision;
        uint16 actionCode;
        uint16 schemaVersion;
        uint32 policyVersion;
        address fan;
        bytes32 creatorId;
        bytes32 campaignId;
        uint32 occurredDay;
        bytes32 evidenceCommitment;
        bytes32 migrationBatchId;
        uint32 bindingVersion;
    }

    struct CredentialIntent {
        uint8 kind;
        uint8 mode;
        bytes32 issuanceKey;
        uint256 tokenId;
        string metadataUri;
    }

    struct ExpectedAttestation {
        bytes32 uid;
        bytes32 schema;
        bytes32 refUID;
        bytes32 dataHash;
        address recipient;
        address attester;
    }

    function actionName(uint16 code) external pure returns (string memory) {
        return _actionName(code);
    }

    function _actionName(uint16 code) private pure returns (string memory) {
        if (code == 1) return "FAN_VERIFIED";
        if (code == 2) return "LIVE_RESERVED";
        if (code == 3) return "LIVE_ATTENDED";
        if (code == 4) return "MISSION_COMPLETED";
        if (code == 5) return "SURVEY_SUBMITTED";
        if (code == 6) return "FIRST_REACTION";
        if (code == 7) return "WELCOME_COMPLETED";
        if (code == 8) return "FIRST_COMMENT";
        if (code == 9) return "INVITE_COMPLETED";
        if (code == 10) return "DAILY_CHECKIN";
        if (code == 11) return "COLLECTIBLE_CLAIMED";
        return "";
    }

    function emitFanActionRecorded(
        bytes32 actionId,
        bytes32 occurrenceId,
        bytes32 easUID,
        uint8 origin,
        ActionRequest calldata request
    ) external {
        emit FanActionRecorded(
            actionId,
            request.fan,
            request.campaignId,
            occurrenceId,
            request.revision,
            request.creatorId,
            _actionName(request.actionCode),
            request.schemaVersion,
            request.policyVersion,
            easUID,
            request.occurredDay,
            origin,
            request.migrationBatchId
        );
    }

    function hashIntent(
        uint8 kind,
        uint8 mode,
        bytes32 issuanceKey,
        uint256 tokenId,
        string calldata metadataUri,
        address nftContract
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(kind, mode, issuanceKey, tokenId, metadataUri, nftContract));
    }

    function hashRequest(
        uint8 operation,
        ActionRequest calldata request,
        CredentialIntent[] calldata intents
    ) external view returns (bytes32) {
        IByUsActionHubConfig hub = IByUsActionHubConfig(msg.sender);
        bytes32[] memory intentHashes = new bytes32[](intents.length);
        for (uint256 i; i < intents.length; ++i) {
            CredentialIntent calldata intent = intents[i];
            intentHashes[i] = keccak256(
                abi.encode(
                    intent.kind,
                    intent.mode,
                    intent.issuanceKey,
                    intent.tokenId,
                    intent.metadataUri,
                    hub.getAssetBinding(request.bindingVersion, intent.kind)
                )
            );
        }
        return keccak256(
            abi.encode(
                block.chainid,
                msg.sender,
                hub.environmentId(),
                operation,
                request,
                hub.getSchema(request.schemaVersion),
                keccak256(abi.encode(intentHashes))
            )
        );
    }

    function verifyExisting(
        uint8 kind,
        address nft,
        address fan,
        bytes32 issuanceKey,
        uint256 tokenId,
        string calldata metadataUri
    ) external view returns (bool) {
        return _verifyExisting(kind, nft, fan, issuanceKey, tokenId, metadataUri);
    }

    function _verifyExisting(
        uint8 kind,
        address nft,
        address fan,
        bytes32 issuanceKey,
        uint256 tokenId,
        string calldata metadataUri
    ) internal view returns (bool) {
        bytes32 uriHash = keccak256(bytes(metadataUri));
        if (kind == 0) {
            return IByUsPassport(nft).tokenByPassportId(issuanceKey) == tokenId
                && IByUsPassport(nft).ownerOf(tokenId) == fan
                && keccak256(bytes(IByUsPassport(nft).tokenURI(tokenId))) == uriHash;
        }
        if (kind == 1) {
            return IByUsStamp(nft).tokenByIssuanceId(issuanceKey) == tokenId
                && IByUsStamp(nft).balanceOf(fan, tokenId) == 1
                && keccak256(bytes(IByUsStamp(nft).uri(tokenId))) == uriHash;
        }
        return IByUsCollectible(nft).tokenByClaimId(issuanceKey) == tokenId
            && IByUsCollectible(nft).ownerOf(tokenId) == fan
            && keccak256(bytes(IByUsCollectible(nft).tokenURI(tokenId))) == uriHash;
    }

    /// @dev Called by the Hub with delegatecall so the Hub remains the NFT minter.
    function executeIntent(
        uint8 kind,
        uint8 mode,
        address nft,
        address fan,
        bytes32 issuanceKey,
        uint256 tokenId,
        string calldata metadataUri
    ) external returns (uint256 resolvedTokenId, uint8 linkOrigin) {
        if (issuanceKey == bytes32(0) || bytes(metadataUri).length == 0) {
            revert InvalidCredentialIntent();
        }
        if (mode == 0) {
            if (tokenId != 0) revert InvalidCredentialIntent();
            if (kind == 0) {
                resolvedTokenId = IByUsPassport(nft).mint(fan, issuanceKey, metadataUri);
            } else if (kind == 1) {
                resolvedTokenId = IByUsStamp(nft).mint(fan, issuanceKey, metadataUri);
            } else {
                resolvedTokenId = IByUsCollectible(nft).mint(fan, issuanceKey, metadataUri);
            }
            return (resolvedTokenId, 0);
        }
        if (mode != 1 || tokenId == 0) revert InvalidCredentialIntent();
        if (!_verifyExisting(kind, nft, fan, issuanceKey, tokenId, metadataUri)) {
            revert ExistingCredentialMismatch();
        }
        return (tokenId, 1);
    }

    function isEasValid(address easAddress, ExpectedAttestation calldata expected)
        external
        view
        returns (bool)
    {
        IEAS eas = IEAS(easAddress);
        try eas.isAttestationValid(expected.uid) returns (bool valid) {
            if (!valid) return false;
        } catch {
            return false;
        }
        try eas.getAttestation(expected.uid) returns (IEAS.Attestation memory attestation) {
            return attestation.uid == expected.uid && attestation.schema == expected.schema
                && attestation.recipient == expected.recipient
                && attestation.attester == expected.attester && attestation.revocationTime == 0
                && (attestation.expirationTime == 0 || attestation.expirationTime > block.timestamp)
                && attestation.refUID == expected.refUID
                && keccak256(attestation.data) == expected.dataHash;
        } catch {
            return false;
        }
    }

    function verifyMerkle(bytes32[] calldata proof, bytes32 root, bytes32 leaf)
        external
        pure
        returns (bool)
    {
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }

    function attestAction(
        address easAddress,
        bytes32 schema,
        address recipient,
        bytes32 refUID,
        bytes calldata data
    ) external returns (bytes32) {
        return IEAS(easAddress)
            .attest(
                IEAS.AttestationRequest({
                    schema: schema,
                    data: IEAS.AttestationRequestData({
                        recipient: recipient,
                        expirationTime: 0,
                        revocable: true,
                        refUID: refUID,
                        data: data,
                        value: 0
                    })
                })
            );
    }

    function revokeAction(address easAddress, bytes32 schema, bytes32 uid) external {
        IEAS(easAddress)
            .revoke(
                IEAS.RevocationRequest({
                    schema: schema, data: IEAS.RevocationRequestData({ uid: uid, value: 0 })
                })
            );
    }
}
