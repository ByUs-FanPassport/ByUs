// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";
import { KyaaCredentialMigrator } from "../src/KyaaCredentialMigrator.sol";

contract KyaaCredentialMigrationGiwaTest is Test {
    address constant HUB = address(bytes20(hex"bd9991a26d0a0bf744ecdb8ad4f59f60a9132956"));
    address constant LEGACY_HUB = address(bytes20(hex"ba3d8f804a316ef0675083e0ed6a1b5435b7bf0d"));
    address constant GOVERNANCE = address(bytes20(hex"40eaeb0b73c50da5053502eb3b836a6effe54642"));
    address constant ADMIN = address(bytes20(hex"eee82f960476c888950c798c444c1fd92cbbfe50"));
    address constant OLD_PASSPORT = address(bytes20(hex"17f9fb7658a326dd88db523739c227faf50fca20"));
    address constant OLD_STAMP = address(bytes20(hex"1adcde3473c4e884e60205b397ece744d8892285"));
    address constant NEW_PASSPORT = address(bytes20(hex"b6c5f48d770a732deb374226eda1e5be209b7ed4"));
    address constant NEW_STAMP = address(bytes20(hex"527a70c0f7cf129650dc282b709327c5958a4ccf"));

    struct Sample {
        KyaaCredentialMigrator.Item item;
        ByUsActionHub.CredentialRef[] refs;
    }

    function setUp() public {
        if (!vm.envOr("RUN_KYAA_REPLACEMENT_FORK", false)) {
            vm.skip(true, "requires private inventory-derived samples and pinned GIWA RPC");
            return;
        }
        vm.createSelectFork(
            vm.envOr("KYAA_REPLACEMENT_FORK_RPC", string("https://sepolia-rpc.giwa.io")), 38_593_218
        );
        assertEq(block.chainid, 91_342);
    }

    function pair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return keccak256(a < b ? bytes.concat(a, b) : bytes.concat(b, a));
    }

    function testRealLegacyAndBothHubCredentialsPreserveHistoryThroughTimelock() public {
        Sample[] memory samples =
            abi.decode(vm.envBytes("KYAA_REPLACEMENT_FORK_SAMPLES"), (Sample[]));
        assertEq(samples.length, 3);
        assertEq(samples[0].item.sourceHub, address(0));
        assertEq(samples[1].item.sourceHub, HUB);
        assertEq(samples[2].item.sourceHub, LEGACY_HUB);
        bytes32 batchId = keccak256("replacement-fork-only");
        KyaaCredentialMigrator migrator = new KyaaCredentialMigrator(
            GOVERNANCE, ADMIN, HUB, LEGACY_HUB, OLD_PASSPORT, OLD_STAMP, NEW_PASSPORT, NEW_STAMP
        );
        bytes32[3] memory leaves;
        bytes32[3] memory records;
        for (uint256 i; i < samples.length; ++i) {
            samples[i].item.batchId = batchId;
            leaves[i] = migrator.leafHash(samples[i].item);
            if (samples[i].item.sourceHub != address(0)) {
                records[i] = keccak256(
                    abi.encode(
                        ByUsActionHub(samples[i].item.sourceHub)
                            .getAction(samples[i].item.sourceActionId)
                    )
                );
            }
        }
        bytes32 root = pair(pair(leaves[0], leaves[1]), leaves[2]);
        TimelockController timelock = TimelockController(payable(GOVERNANCE));
        uint256 delay = timelock.getMinDelay();
        assertEq(delay, 172_800);
        address[] memory targets = new address[](3);
        targets[0] = NEW_PASSPORT;
        targets[1] = NEW_STAMP;
        targets[2] = address(migrator);
        bytes[] memory payloads = new bytes[](3);
        payloads[0] = abi.encodeWithSignature(
            "grantRole(bytes32,address)", keccak256("MINTER_ROLE"), address(migrator)
        );
        payloads[1] = payloads[0];
        payloads[2] = abi.encodeCall(
            migrator.registerBatch,
            (batchId, root, keccak256("manifest"), 3, 3, uint64(block.timestamp + 30 days))
        );
        bytes32 salt = keccak256("replacement-fork-batch");
        uint256[] memory values = new uint256[](3);
        vm.prank(ADMIN);
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), salt, delay);
        vm.prank(ADMIN);
        vm.expectRevert();
        timelock.executeBatch(targets, values, payloads, bytes32(0), salt);
        vm.warp(block.timestamp + delay);
        vm.prank(ADMIN);
        timelock.executeBatch(targets, values, payloads, bytes32(0), salt);

        for (uint256 i; i < samples.length; ++i) {
            bytes32[] memory proof = new bytes32[](i == 2 ? 1 : 2);
            proof[0] = i == 2 ? pair(leaves[0], leaves[1]) : leaves[i == 0 ? 1 : 0];
            if (i != 2) proof[1] = leaves[2];
            KyaaCredentialMigrator.Item memory item = samples[i].item;
            vm.prank(ADMIN);
            uint256 token = migrator.migrate(item, "ipfs://kyaa-fork-only", proof, samples[i].refs);
            vm.prank(ADMIN);
            assertEq(migrator.migrate(item, "ipfs://kyaa-fork-only", proof, samples[i].refs), token);
            if (item.kind == 0) {
                assertEq(ByUsPassport(OLD_PASSPORT).ownerOf(item.oldTokenId), item.recipient);
                assertEq(
                    keccak256(bytes(ByUsPassport(OLD_PASSPORT).tokenURI(item.oldTokenId))),
                    item.oldUriHash
                );
                assertEq(ByUsPassport(NEW_PASSPORT).ownerOf(token), item.recipient);
                assertEq(ByUsPassport(NEW_PASSPORT).tokenByPassportId(item.issuanceKey), token);
                assertEq(ByUsPassport(NEW_PASSPORT).tokenURI(token), "ipfs://kyaa-fork-only");
            } else {
                assertEq(ByUsStamp(OLD_STAMP).balanceOf(item.recipient, item.oldTokenId), 1);
                assertEq(
                    keccak256(bytes(ByUsStamp(OLD_STAMP).uri(item.oldTokenId))), item.oldUriHash
                );
                assertEq(ByUsStamp(NEW_STAMP).balanceOf(item.recipient, token), 1);
                assertEq(ByUsStamp(NEW_STAMP).tokenByIssuanceId(item.issuanceKey), token);
                assertEq(ByUsStamp(NEW_STAMP).uri(token), "ipfs://kyaa-fork-only");
            }
            if (item.sourceHub != address(0)) {
                assertEq(
                    keccak256(
                        abi.encode(ByUsActionHub(item.sourceHub).getAction(item.sourceActionId))
                    ),
                    records[i]
                );
            }
        }
        (,,,,, uint32 itemsUsed, uint32 mintsUsed,) = migrator.batches(batchId);
        assertEq(itemsUsed, 3);
        assertEq(mintsUsed, 3);
        assertEq(
            ByUsActionHub(HUB).getAssetBinding(1, ByUsActionHub.CredentialKind.PASSPORT),
            OLD_PASSPORT
        );
        assertEq(
            ByUsActionHub(HUB).getAssetBinding(1, ByUsActionHub.CredentialKind.STAMP), OLD_STAMP
        );
    }
}
