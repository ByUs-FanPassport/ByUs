// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ByUsActionHubTest } from "./ByUsActionHub.t.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { KyaaActionHub } from "../src/KyaaActionHub.sol";
import { KyaaPassport } from "../src/KyaaPassport.sol";
import { KyaaStamp } from "../src/KyaaStamp.sol";

contract KyaaActionHubTest is ByUsActionHubTest {
    function testKyaaUpgradePreservesOldActionsAndAllowsBothBindings() public {
        ByUsActionHub.ActionRequest memory oldRequest = _request(keccak256("old"), 2, fan);
        vm.prank(writer);
        ByUsActionHub.ActionResult memory oldResult =
            hub.recordAndIssue(oldRequest, _stampIntent("old"));
        KyaaPassport nextPassport = new KyaaPassport(admin, address(hub));
        KyaaStamp nextStamp = new KyaaStamp(admin, address(hub));
        _upgrade(nextPassport, nextStamp, true);
        assertEq(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.PASSPORT), address(passport));
        assertEq(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.STAMP), address(stamp));
        assertEq(
            hub.getAssetBinding(2, ByUsActionHub.CredentialKind.PASSPORT), address(nextPassport)
        );
        assertEq(hub.getAssetBinding(2, ByUsActionHub.CredentialKind.STAMP), address(nextStamp));
        assertEq(hub.getAssetBinding(2, ByUsActionHub.CredentialKind.COLLECTIBLE), address(0));
        assertEq(hub.getAssetBinding(3, ByUsActionHub.CredentialKind.STAMP), address(0));
        vm.prank(writer);
        assertEq(hub.recordAndIssue(oldRequest, _stampIntent("old")).actionId, oldResult.actionId);
        vm.prank(writer);
        hub.recordAndIssue(_request(keccak256("old-pending"), 2, fan), _stampIntent("old-pending"));
        ByUsActionHub.ActionRequest memory newRequest = _request(keccak256("new"), 2, fan);
        newRequest.bindingVersion = 2;
        vm.prank(writer);
        ByUsActionHub.ActionResult memory newResult =
            hub.recordAndIssue(newRequest, _stampIntent("new"));
        vm.prank(writer);
        assertEq(hub.recordAndIssue(newRequest, _stampIntent("new")).actionId, newResult.actionId);
        assertEq(stamp.balanceOf(fan, 1), 1);
        assertEq(stamp.balanceOf(fan, 2), 1);
        assertEq(nextStamp.balanceOf(fan, 1), 1);
        assertEq(stamp.uri(1), "ipfs://old");
        assertEq(nextStamp.uri(1), "ipfs://new");
        oldRequest.revision = 2;
        ByUsActionHub.CredentialIntent[] memory links = _stampIntent("old");
        links[0].mode = ByUsActionHub.IntentMode.LINK_EXISTING;
        links[0].tokenId = 1;
        vm.prank(corrector);
        hub.correct(oldResult.actionId, oldRequest, links);
        assertEq(stamp.uri(1), "ipfs://old");
        assertEq(nextStamp.uri(1), "ipfs://new");
    }

    function testKyaaBindingUnavailableUntilAtomicInitialization() public {
        KyaaPassport nextPassport = new KyaaPassport(admin, address(hub));
        KyaaStamp nextStamp = new KyaaStamp(admin, address(hub));
        _upgrade(nextPassport, nextStamp, false);
        assertEq(hub.getAssetBinding(2, ByUsActionHub.CredentialKind.STAMP), address(0));
        vm.prank(stranger);
        vm.expectRevert();
        KyaaActionHub(address(hub)).initializeKyaaBinding();
        vm.prank(admin);
        KyaaActionHub(address(hub)).initializeKyaaBinding();
        assertEq(hub.getAssetBinding(2, ByUsActionHub.CredentialKind.STAMP), address(nextStamp));
        vm.prank(admin);
        vm.expectRevert();
        KyaaActionHub(address(hub)).initializeKyaaBinding();
    }

    function testKyaaRejectsWrongAdminAndMinter() public {
        KyaaPassport nextPassport = new KyaaPassport(admin, address(hub));
        KyaaStamp wrongAdmin = new KyaaStamp(stranger, address(hub));
        vm.expectRevert();
        new KyaaActionHub(address(hub), address(nextPassport), address(wrongAdmin));
        KyaaStamp wrongMinter = new KyaaStamp(admin, writer);
        vm.expectRevert();
        new KyaaActionHub(address(hub), address(nextPassport), address(wrongMinter));
    }

    function _upgrade(KyaaPassport nextPassport, KyaaStamp nextStamp, bool initialize) internal {
        KyaaActionHub next =
            new KyaaActionHub(address(hub), address(nextPassport), address(nextStamp));
        assertLe(address(next).code.length, 24_576);
        bytes memory data = initialize ? abi.encodeCall(next.initializeKyaaBinding, ()) : bytes("");
        bytes memory upgradeCall =
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(next), data);
        bytes32 salt = keccak256("kyaa-binding-2");
        timelock.schedule(address(hub), 0, upgradeCall, bytes32(0), salt, 2 days);
        vm.warp(block.timestamp + 2 days);
        timelock.execute(address(hub), 0, upgradeCall, bytes32(0), salt);
    }
}
