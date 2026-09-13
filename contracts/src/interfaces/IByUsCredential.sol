// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IByUsPassport {
    function mint(address to, bytes32 passportId, string calldata metadataUri)
        external
        returns (uint256 tokenId);
    function tokenByPassportId(bytes32 passportId) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

interface IByUsStamp {
    function mint(address to, bytes32 issuanceId, string calldata metadataUri)
        external
        returns (uint256 tokenId);
    function tokenByIssuanceId(bytes32 issuanceId) external view returns (uint256);
    function balanceOf(address account, uint256 tokenId) external view returns (uint256);
    function uri(uint256 tokenId) external view returns (string memory);
}

interface IByUsCollectible {
    function mint(address to, bytes32 claimKey, string calldata metadataUri)
        external
        returns (uint256 tokenId);
    function tokenByClaimId(bytes32 claimKey) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}
