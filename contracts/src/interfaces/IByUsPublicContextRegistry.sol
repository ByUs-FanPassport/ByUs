// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IByUsPublicContextRegistry {
    function isValidContext(bytes32 creatorId, bytes32 campaignId) external view returns (bool);
}
