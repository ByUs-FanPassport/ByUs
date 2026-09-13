// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IEAS } from "../interfaces/IEAS.sol";

contract MockEAS is IEAS {
    mapping(bytes32 uid => Attestation attestation) internal attestations;
    uint256 public attestCount;
    uint256 public revokeCount;
    bool public failAttest;
    bool public returnZero;

    function setFailAttest(bool value) external {
        failAttest = value;
    }

    function setReturnZero(bool value) external {
        returnZero = value;
    }

    function attest(AttestationRequest calldata request) external payable returns (bytes32 uid) {
        if (failAttest) revert("EAS_FAIL");
        ++attestCount;
        if (returnZero) return bytes32(0);
        uid = keccak256(abi.encode(address(this), msg.sender, attestCount, request));
        attestations[uid] = Attestation({
            uid: uid,
            schema: request.schema,
            time: uint64(block.timestamp),
            expirationTime: request.data.expirationTime,
            revocationTime: 0,
            refUID: request.data.refUID,
            recipient: request.data.recipient,
            attester: msg.sender,
            revocable: request.data.revocable,
            data: request.data.data
        });
    }

    function revoke(RevocationRequest calldata request) external payable {
        Attestation storage attestation = attestations[request.data.uid];
        require(attestation.uid != bytes32(0), "MISSING");
        require(attestation.schema == request.schema, "SCHEMA");
        require(attestation.attester == msg.sender, "ATTESTER");
        require(attestation.revocationTime == 0, "REVOKED");
        attestation.revocationTime = uint64(block.timestamp);
        ++revokeCount;
    }

    function isAttestationValid(bytes32 uid) external view returns (bool) {
        Attestation storage attestation = attestations[uid];
        return attestation.uid != bytes32(0) && attestation.revocationTime == 0
            && (attestation.expirationTime == 0 || attestation.expirationTime > block.timestamp);
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return attestations[uid];
    }

    function forceRecipient(bytes32 uid, address recipient) external {
        attestations[uid].recipient = recipient;
    }
}
