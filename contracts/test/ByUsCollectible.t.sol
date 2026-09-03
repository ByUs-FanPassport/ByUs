// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ByUsCollectible } from "../src/ByUsCollectible.sol";

contract ByUsCollectibleTest is Test {
    address admin = makeAddr("admin"); address relayer = makeAddr("relayer"); address fan = makeAddr("fan"); address stranger = makeAddr("stranger");
    ByUsCollectible collectible;
    function setUp() public { collectible = new ByUsCollectible(admin, relayer); }

    function testMintStartsAtOneAndIsUnique() public {
        bytes32 key = keccak256(bytes("3ff058e6-8865-46c5-ae01-94a93f1dbe3c"));
        vm.prank(relayer); uint256 tokenId = collectible.mint(fan, key, "ipfs://metadata");
        assertEq(tokenId, 1); assertEq(collectible.tokenByClaimId(key), 1); assertEq(collectible.ownerOf(1), fan); assertEq(collectible.tokenURI(1), "ipfs://metadata");
        vm.prank(relayer); vm.expectRevert(abi.encodeWithSelector(ByUsCollectible.CollectibleAlreadyMinted.selector, key)); collectible.mint(fan, key, "ipfs://other");
    }

    function testSoulboundAndApprovalBlocked() public {
        vm.prank(relayer); uint256 id = collectible.mint(fan, keccak256("claim"), "ipfs://metadata");
        vm.prank(fan); vm.expectRevert(ByUsCollectible.Soulbound.selector); collectible.transferFrom(fan, stranger, id);
        vm.prank(fan); vm.expectRevert(ByUsCollectible.Soulbound.selector); collectible.approve(stranger, id);
    }

    function testRolesPauseAndInvalidKey() public {
        assertTrue(collectible.hasRole(collectible.DEFAULT_ADMIN_ROLE(), admin)); assertTrue(collectible.hasRole(collectible.MINTER_ROLE(), relayer));
        vm.prank(stranger); vm.expectRevert(); collectible.mint(fan, keccak256("x"), "ipfs://x");
        vm.prank(relayer); vm.expectRevert(ByUsCollectible.InvalidClaimKey.selector); collectible.mint(fan, bytes32(0), "ipfs://x");
        vm.prank(admin); collectible.pause(); vm.prank(relayer); vm.expectRevert(Pausable.EnforcedPause.selector); collectible.mint(fan, keccak256("y"), "ipfs://y");
    }
}
