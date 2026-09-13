// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsPublicContextRegistryV2 } from "../src/ByUsPublicContextRegistryV2.sol";

contract ByUsPublicContextRegistryV2Test is Test {
    TimelockController internal timelock;
    ByUsPublicContextRegistryV2 internal registry;
    address internal registrar = makeAddr("registrar");
    address internal writer = makeAddr("writer");
    bytes32 internal constant CREATOR = keccak256("creator");
    bytes32 internal constant CAMPAIGN = keccak256("campaign");

    function setUp() public {
        vm.warp(2_000_000_000);
        address[] memory operators = new address[](1);
        operators[0] = address(this);
        timelock = new TimelockController(2 days, operators, operators, address(0));
        registry = new ByUsPublicContextRegistryV2(address(timelock), registrar);
    }

    function testRegistrarCanRegisterImmediatelyButWriterCannot() public {
        uint256 before = block.timestamp;
        vm.prank(writer);
        vm.expectRevert(ByUsPublicContextRegistryV2.AccessDenied.selector);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(registrar);
        registry.registerCreator(CREATOR, "creator");
        assertTrue(registry.isValidContext(CREATOR, 0));
        assertEq(block.timestamp, before);
    }

    function testRegistrarCannotModifyGovernanceOrExistingContexts() public {
        vm.startPrank(registrar);
        registry.registerCreator(CREATOR, "creator");
        vm.expectRevert(ByUsPublicContextRegistryV2.AccessDenied.selector);
        registry.setRegistrar(writer);
        vm.expectRevert(ByUsPublicContextRegistryV2.AccessDenied.selector);
        registry.setCreatorActive(CREATOR, false);
        vm.expectRevert(ByUsPublicContextRegistryV2.AccessDenied.selector);
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        vm.expectRevert(ByUsPublicContextRegistryV2.AccessDenied.selector);
        registry.setCampaignActive(CAMPAIGN, false);
        vm.stopPrank();
    }

    function testInactiveCreatorCannotBeRegisteredAgain() public {
        vm.prank(registrar);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(address(timelock));
        registry.setCreatorActive(CREATOR, false);
        vm.prank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV2.AlreadyRegistered.selector);
        registry.registerCreator(CREATOR, "replacement");
        assertFalse(registry.isValidContext(CREATOR, 0));
    }

    function testRegistrarRotationRequiresReal48HourTimelock() public {
        bytes memory data = abi.encodeCall(registry.setRegistrar, (writer));
        timelock.schedule(address(registry), 0, data, 0, 0, 2 days);
        vm.expectRevert();
        timelock.execute(address(registry), 0, data, 0, 0);
        vm.warp(block.timestamp + 2 days);
        timelock.execute(address(registry), 0, data, 0, 0);
        assertEq(registry.registrar(), writer);
        vm.prank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV2.AccessDenied.selector);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(writer);
        registry.registerCreator(CREATOR, "creator");
    }

    function testRejectsInvalidRegistrationsAndPreservesCampaignOwnership() public {
        vm.startPrank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV2.InvalidContext.selector);
        registry.registerCreator(0, "creator");
        vm.expectRevert(ByUsPublicContextRegistryV2.InvalidContext.selector);
        registry.registerCreator(CREATOR, "");
        registry.registerCreator(CREATOR, "creator");
        vm.stopPrank();
        vm.startPrank(address(timelock));
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        registry.registerCreator(keccak256("other"), "other");
        assertFalse(registry.isValidContext(keccak256("other"), CAMPAIGN));
        registry.setCampaignActive(CAMPAIGN, false);
        vm.expectRevert(ByUsPublicContextRegistryV2.AlreadyRegistered.selector);
        registry.registerCampaign(CAMPAIGN, CREATOR, "replacement");
        vm.stopPrank();
        assertFalse(registry.isValidContext(CREATOR, CAMPAIGN));
        assertTrue(registry.isValidContext(0, 0));
        assertFalse(registry.isValidContext(0, CAMPAIGN));
    }
}
