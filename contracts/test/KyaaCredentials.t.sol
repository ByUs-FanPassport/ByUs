// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ByUsCredentialsTest } from "./ByUsCredentials.t.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { KyaaPassport } from "../src/KyaaPassport.sol";
import { KyaaStamp } from "../src/KyaaStamp.sol";

contract KyaaCredentialsTest is ByUsCredentialsTest {
    function setUp() public override {
        passport = new KyaaPassport(admin, relayer);
        stamp = new KyaaStamp(admin, relayer);
    }

    function testKyaaNamesAndStandardInterfaces() public view {
        assertEq(passport.name(), "kyaa Fan Passport");
        assertEq(passport.symbol(), "KYAAPASS");
        assertTrue(passport.supportsInterface(0x80ac58cd));
        assertTrue(passport.supportsInterface(0x5b5e139f));
        assertTrue(stamp.supportsInterface(0xd9b67a26));
        assertTrue(stamp.supportsInterface(0x0e89341c));
    }

    function testEarlierPassportAndMetadataRemainUnchanged() public {
        ByUsPassport earlier = new ByUsPassport(admin, relayer);
        bytes32 key = keccak256("earlier-passport");
        vm.prank(relayer);
        uint256 tokenId = earlier.mint(fan, key, "ipfs://earlier-passport");

        assertEq(earlier.name(), "ByUs Fan Passport");
        assertEq(earlier.symbol(), "BYUSPASS");
        assertEq(earlier.ownerOf(tokenId), fan);
        assertEq(earlier.tokenURI(tokenId), "ipfs://earlier-passport");
        assertEq(passport.tokenByPassportId(key), 0);
    }
}
