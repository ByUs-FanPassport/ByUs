// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { ByUsPublicContextRegistryV3 } from "../src/ByUsPublicContextRegistryV3.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";
import { KyaaActionHub } from "../src/KyaaActionHub.sol";
import { KyaaPassport } from "../src/KyaaPassport.sol";
import { KyaaStamp } from "../src/KyaaStamp.sol";

contract KyaaGiwaUpgradeTest is Test {
    address constant HUB = address(bytes20(hex"bd9991a26d0a0bf744ecdb8ad4f59f60a9132956"));
    address constant GOVERNANCE = address(bytes20(hex"40eaeb0b73c50da5053502eb3b836a6effe54642"));
    address constant ADMIN = address(bytes20(hex"eee82f960476c888950c798c444c1fd92cbbfe50"));
    address constant WRITER = address(bytes20(hex"d0f5dd0885ca87f2c9f4d1017fa1714dd98dc815"));
    address constant REGISTRY = address(bytes20(hex"4e104e5dfb3d466a2aac9ed0cf7572578068529b"));
    bytes32 constant HUB_STORAGE =
        0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700;

    function setUp() public {
        if (!vm.envOr("RUN_KYAA_GIWA_FORK", false)) {
            vm.skip(true, "set RUN_KYAA_GIWA_FORK=1 for the pinned deployed implementation");
            return;
        }
        vm.createSelectFork("https://sepolia-rpc.giwa.io", 38_541_351);
        assertEq(block.chainid, 91_342);
    }

    function testDeployedRuntimePreservesV1AndIssuesKyaaAfterTimelockUpgrade() public {
        ByUsActionHub hub = ByUsActionHub(HUB);
        address originalImplementation = address(
            uint160(
                uint256(
                    vm.load(HUB, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)
                )
            )
        );
        assertEq(
            originalImplementation.codehash,
            0x3e50e0def7b3823e63bca919f5ecc1a09a709b4b62eb7dae1c710cb1c20d17d9
        );
        ByUsPassport oldPassport =
            ByUsPassport(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.PASSPORT));
        ByUsStamp oldStamp = ByUsStamp(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.STAMP));
        string memory existingUri = oldPassport.tokenURI(1);
        bytes32 creator = keccak256("kyaa-fork-only-creator");
        vm.prank(ADMIN);
        ByUsPublicContextRegistryV3(REGISTRY).registerCreator(creator, "kyaa-fork-only");
        address fan = makeAddr("kyaa-fork-fan");
        ByUsActionHub.ActionRequest memory request = ByUsActionHub.ActionRequest({
            sourceOccurrence: keccak256("before-kyaa"),
            revision: 1,
            actionCode: 6,
            schemaVersion: 1,
            policyVersion: 1,
            fan: fan,
            creatorId: creator,
            campaignId: bytes32(0),
            occurredDay: uint32(block.timestamp / 1 days),
            evidenceCommitment: keccak256("fork-evidence"),
            migrationBatchId: bytes32(0),
            bindingVersion: 1
        });
        ByUsActionHub.CredentialIntent[] memory oldIntent = new ByUsActionHub.CredentialIntent[](1);
        oldIntent[0] = ByUsActionHub.CredentialIntent(
            ByUsActionHub.CredentialKind.STAMP,
            ByUsActionHub.IntentMode.MINT,
            keccak256("before-kyaa-stamp"),
            0,
            "ipfs://before-kyaa"
        );
        vm.prank(WRITER);
        ByUsActionHub.ActionResult memory previous = hub.recordAndIssue(request, oldIntent);
        bytes32 previousRecord = keccak256(abi.encode(hub.getAction(previous.actionId)));
        uint256 oldToken = oldStamp.tokenByIssuanceId(oldIntent[0].issuanceKey);
        bytes32[10] memory beforeSlots;
        for (uint256 i; i < beforeSlots.length; ++i) {
            beforeSlots[i] = vm.load(HUB, bytes32(uint256(HUB_STORAGE) + i));
        }

        KyaaPassport nextPassport = new KyaaPassport(GOVERNANCE, HUB);
        KyaaStamp nextStamp = new KyaaStamp(GOVERNANCE, HUB);
        KyaaActionHub next = new KyaaActionHub(HUB, address(nextPassport), address(nextStamp));
        assertLe(address(next).code.length, 24_576);
        bytes memory upgrade = abi.encodeWithSignature(
            "upgradeToAndCall(address,bytes)",
            address(next),
            abi.encodeCall(next.initializeKyaaBinding, ())
        );
        TimelockController timelock = TimelockController(payable(GOVERNANCE));
        uint256 delay = timelock.getMinDelay();
        assertEq(delay, 172_800);
        bytes32 salt = keccak256("kyaa-fork-upgrade");
        vm.prank(ADMIN);
        timelock.schedule(HUB, 0, upgrade, bytes32(0), salt, delay);
        vm.warp(block.timestamp + delay);
        vm.prank(ADMIN);
        timelock.execute(HUB, 0, upgrade, bytes32(0), salt);
        for (uint256 i; i < beforeSlots.length; ++i) {
            assertEq(vm.load(HUB, bytes32(uint256(HUB_STORAGE) + i)), beforeSlots[i]);
        }
        assertEq(keccak256(abi.encode(hub.getAction(previous.actionId))), previousRecord);
        assertEq(oldPassport.tokenURI(1), existingUri);
        assertEq(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.STAMP), address(oldStamp));
        vm.prank(WRITER);
        assertEq(hub.recordAndIssue(request, oldIntent).actionId, previous.actionId);
        assertEq(oldStamp.tokenByIssuanceId(oldIntent[0].issuanceKey), oldToken);

        request.sourceOccurrence = keccak256("after-kyaa");
        request.actionCode = 1;
        request.bindingVersion = 2;
        ByUsActionHub.CredentialIntent[] memory nextIntents =
            new ByUsActionHub.CredentialIntent[](2);
        nextIntents[0] = ByUsActionHub.CredentialIntent(
            ByUsActionHub.CredentialKind.PASSPORT,
            ByUsActionHub.IntentMode.MINT,
            keccak256("kyaa-passport"),
            0,
            "ipfs://kyaa-passport"
        );
        nextIntents[1] = ByUsActionHub.CredentialIntent(
            ByUsActionHub.CredentialKind.STAMP,
            ByUsActionHub.IntentMode.MINT,
            keccak256("kyaa-stamp"),
            0,
            "ipfs://kyaa-stamp"
        );
        vm.prank(WRITER);
        ByUsActionHub.ActionResult memory result = hub.recordAndIssue(request, nextIntents);
        assertTrue(result.easUID != bytes32(0));
        assertEq(nextPassport.name(), "kyaa Fan Passport");
        assertEq(nextPassport.ownerOf(1), fan);
        assertEq(nextStamp.balanceOf(fan, 1), 1);
        assertEq(oldStamp.uri(oldToken), "ipfs://before-kyaa");
    }
}
