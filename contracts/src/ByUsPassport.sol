// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ERC721Pausable } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import {
    ERC721URIStorage
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract ByUsPassport is ERC721, ERC721URIStorage, ERC721Pausable, AccessControlDefaultAdminRules {
    error Soulbound();
    error PassportAlreadyMinted(bytes32 passportId);
    error InvalidPassportId();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 private _nextTokenId = 1;
    mapping(bytes32 passportId => uint256 tokenId) public tokenByPassportId;

    event PassportMinted(
        bytes32 indexed passportId, uint256 indexed tokenId, address indexed to, string metadataUri
    );

    constructor(address initialAdmin, address initialMinter)
        ERC721("ByUs Fan Passport", "BYUSPASS")
        AccessControlDefaultAdminRules(2 days, initialAdmin)
    {
        _grantRole(PAUSER_ROLE, initialAdmin);
        _grantRole(MINTER_ROLE, initialMinter);
    }

    function mint(address to, bytes32 passportId, string calldata metadataUri)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (passportId == bytes32(0)) revert InvalidPassportId();
        if (tokenByPassportId[passportId] != 0) revert PassportAlreadyMinted(passportId);

        tokenId = _nextTokenId++;
        tokenByPassportId[passportId] = tokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataUri);
        emit PassportMinted(passportId, tokenId, to, metadataUri);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Pausable)
        returns (address)
    {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControlDefaultAdminRules)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
