// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";

contract ByUsCredentialsTest is Test {
    address internal admin = makeAddr("admin");
    address internal relayer = makeAddr("relayer");
    address internal fan = makeAddr("fan");
    address internal stranger = makeAddr("stranger");

    ByUsPassport internal passport;
    ByUsStamp internal stamp;

    function setUp() public {
        passport = new ByUsPassport(admin, relayer);
        stamp = new ByUsStamp(admin, relayer);
    }

    function testRolesAreSeparated() public view {
        assertTrue(passport.hasRole(passport.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(passport.hasRole(passport.PAUSER_ROLE(), admin));
        assertTrue(passport.hasRole(passport.MINTER_ROLE(), relayer));
        assertFalse(passport.hasRole(passport.DEFAULT_ADMIN_ROLE(), relayer));
        assertTrue(stamp.hasRole(stamp.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(stamp.hasRole(stamp.PAUSER_ROLE(), admin));
        assertTrue(stamp.hasRole(stamp.MINTER_ROLE(), relayer));
        assertFalse(stamp.hasRole(stamp.DEFAULT_ADMIN_ROLE(), relayer));
    }

    function testPassportMintIsUniqueAndMetadataIsFixed() public {
        bytes32 passportId = keccak256("passport-1");
        vm.prank(relayer);
        uint256 tokenId = passport.mint(fan, passportId, "ipfs://passport-1");

        assertEq(tokenId, 1);
        assertEq(passport.ownerOf(tokenId), fan);
        assertEq(passport.tokenURI(tokenId), "ipfs://passport-1");
        assertEq(passport.tokenByPassportId(passportId), tokenId);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(ByUsPassport.PassportAlreadyMinted.selector, passportId)
        );
        passport.mint(fan, passportId, "ipfs://duplicate");
    }

    function testPassportTransferAndApprovalAreBlocked() public {
        vm.prank(relayer);
        uint256 tokenId = passport.mint(fan, keccak256("passport-2"), "ipfs://passport-2");

        vm.prank(fan);
        vm.expectRevert(ByUsPassport.Soulbound.selector);
        passport.transferFrom(fan, stranger, tokenId);

        vm.prank(fan);
        vm.expectRevert(ByUsPassport.Soulbound.selector);
        passport.approve(stranger, tokenId);
    }

    function testStampMintIsUniqueAndTransferIsBlocked() public {
        bytes32 issuanceId = keccak256("attendance-1");
        vm.prank(relayer);
        uint256 tokenId = stamp.mint(fan, issuanceId, "ipfs://attendance-1");

        assertEq(tokenId, 1);
        assertEq(stamp.balanceOf(fan, tokenId), 1);
        assertEq(stamp.uri(tokenId), "ipfs://attendance-1");
        assertEq(stamp.tokenByIssuanceId(issuanceId), tokenId);

        vm.prank(fan);
        vm.expectRevert(ByUsStamp.Soulbound.selector);
        stamp.safeTransferFrom(fan, stranger, tokenId, 1, "");

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ByUsStamp.StampAlreadyMinted.selector, issuanceId));
        stamp.mint(fan, issuanceId, "ipfs://duplicate");
    }

    function testUnauthorizedMintingReverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        passport.mint(fan, keccak256("passport-3"), "ipfs://passport-3");

        vm.prank(stranger);
        vm.expectRevert();
        stamp.mint(fan, keccak256("stamp-3"), "ipfs://stamp-3");
    }

    function testAdminCanPauseAndMintingStops() public {
        vm.prank(admin);
        passport.pause();
        vm.prank(admin);
        stamp.pause();

        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        passport.mint(fan, keccak256("passport-4"), "ipfs://passport-4");

        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stamp.mint(fan, keccak256("stamp-4"), "ipfs://stamp-4");
    }
}

