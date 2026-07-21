// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {
    ERC1155Pausable
} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import { ERC1155Supply } from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

contract ByUsStamp is ERC1155, ERC1155Supply, ERC1155Pausable, AccessControlDefaultAdminRules {
    error Soulbound();
    error StampAlreadyMinted(bytes32 issuanceId);
    error InvalidIssuanceId();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 private _nextTokenId = 1;
    mapping(bytes32 issuanceId => uint256 tokenId) public tokenByIssuanceId;
    mapping(uint256 tokenId => string metadataUri) private _tokenUris;

    event StampMinted(
        bytes32 indexed issuanceId, uint256 indexed tokenId, address indexed to, string metadataUri
    );

    constructor(address initialAdmin, address initialMinter)
        ERC1155("")
        AccessControlDefaultAdminRules(2 days, initialAdmin)
    {
        _grantRole(PAUSER_ROLE, initialAdmin);
        _grantRole(MINTER_ROLE, initialMinter);
    }

    function mint(address to, bytes32 issuanceId, string calldata metadataUri)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (issuanceId == bytes32(0)) revert InvalidIssuanceId();
        if (tokenByIssuanceId[issuanceId] != 0) revert StampAlreadyMinted(issuanceId);

        tokenId = _nextTokenId++;
        tokenByIssuanceId[issuanceId] = tokenId;
        _tokenUris[tokenId] = metadataUri;
        _mint(to, tokenId, 1, "");
        emit StampMinted(issuanceId, tokenId, to, metadataUri);
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        return _tokenUris[tokenId];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply, ERC1155Pausable)
    {
        if (from != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControlDefaultAdminRules)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

