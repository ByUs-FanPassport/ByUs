// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsPublicContextRegistryV3 } from "../src/ByUsPublicContextRegistryV3.sol";

contract ByUsPublicContextRegistryV3Test is Test {
    TimelockController internal timelock;
    ByUsPublicContextRegistryV3 internal registry;
    address internal registrar = makeAddr("registrar");
    address internal writer = makeAddr("writer");
    bytes32 internal constant CREATOR = keccak256("creator");
    bytes32 internal constant CAMPAIGN = keccak256("campaign");

    function setUp() public {
        vm.warp(2_000_000_000);
        address[] memory operators = new address[](1);
        operators[0] = address(this);
        timelock = new TimelockController(2 days, operators, operators, address(0));
        registry = new ByUsPublicContextRegistryV3(address(timelock), registrar);
    }

    function testRegistrarCanRegisterImmediatelyButWriterCannot() public {
        uint256 before = block.timestamp;
        vm.prank(writer);
        vm.expectRevert(ByUsPublicContextRegistryV3.AccessDenied.selector);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(registrar);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(writer);
        vm.expectRevert(ByUsPublicContextRegistryV3.AccessDenied.selector);
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        vm.prank(registrar);
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        assertTrue(registry.isValidContext(CREATOR, CAMPAIGN));
        assertTrue(registry.isValidContext(CREATOR, 0));
        assertEq(block.timestamp, before);
    }

    function testRegistrarCannotModifyGovernanceOrExistingContexts() public {
        vm.startPrank(registrar);
        registry.registerCreator(CREATOR, "creator");
        vm.expectRevert(ByUsPublicContextRegistryV3.AccessDenied.selector);
        registry.setRegistrar(writer);
        vm.expectRevert(ByUsPublicContextRegistryV3.AccessDenied.selector);
        registry.setCreatorActive(CREATOR, false);
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        vm.expectRevert(ByUsPublicContextRegistryV3.AccessDenied.selector);
        registry.setCampaignActive(CAMPAIGN, false);
        vm.stopPrank();
    }

    function testInactiveCreatorCannotBeRegisteredAgain() public {
        vm.prank(registrar);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(address(timelock));
        registry.setCreatorActive(CREATOR, false);
        vm.prank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV3.AlreadyRegistered.selector);
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
        vm.expectRevert(ByUsPublicContextRegistryV3.AccessDenied.selector);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(writer);
        registry.registerCreator(CREATOR, "creator");
    }

    function testRejectsInvalidRegistrationsAndPreservesCampaignOwnership() public {
        vm.startPrank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV3.InvalidContext.selector);
        registry.registerCreator(0, "creator");
        vm.expectRevert(ByUsPublicContextRegistryV3.InvalidContext.selector);
        registry.registerCreator(CREATOR, "");
        registry.registerCreator(CREATOR, "creator");
        vm.stopPrank();
        vm.startPrank(address(timelock));
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        registry.registerCreator(keccak256("other"), "other");
        assertFalse(registry.isValidContext(keccak256("other"), CAMPAIGN));
        registry.setCampaignActive(CAMPAIGN, false);
        vm.expectRevert(ByUsPublicContextRegistryV3.AlreadyRegistered.selector);
        registry.registerCampaign(CAMPAIGN, CREATOR, "replacement");
        vm.stopPrank();
        assertFalse(registry.isValidContext(CREATOR, CAMPAIGN));
        assertTrue(registry.isValidContext(0, 0));
        assertFalse(registry.isValidContext(0, CAMPAIGN));
    }
    function testRegistrarCannotOverwriteCampaignOrUseWrongCreator() public {
        vm.startPrank(registrar);
        registry.registerCreator(CREATOR, "creator");
        bytes32 other = keccak256("other");
        vm.expectRevert(ByUsPublicContextRegistryV3.InvalidContext.selector);
        registry.registerCampaign(CAMPAIGN, other, "campaign");
        vm.expectRevert(ByUsPublicContextRegistryV3.InvalidContext.selector);
        registry.registerCampaign(0, CREATOR, "campaign");
        vm.expectRevert(ByUsPublicContextRegistryV3.InvalidContext.selector);
        registry.registerCampaign(CAMPAIGN, CREATOR, "");
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        registry.registerCreator(other, "other");
        vm.expectRevert(ByUsPublicContextRegistryV3.AlreadyRegistered.selector);
        registry.registerCampaign(CAMPAIGN, other, "replacement");
        assertTrue(registry.isValidContext(CREATOR, CAMPAIGN));
        assertFalse(registry.isValidContext(other, CAMPAIGN));
        vm.stopPrank();
    }

    function testRegistrarCannotRegisterUnderInactiveCreatorOrReactivateCampaign() public {
        vm.prank(registrar);
        registry.registerCreator(CREATOR, "creator");
        vm.prank(registrar);
        registry.registerCampaign(CAMPAIGN, CREATOR, "campaign");
        vm.prank(address(timelock));
        registry.setCampaignActive(CAMPAIGN, false);
        vm.prank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV3.AlreadyRegistered.selector);
        registry.registerCampaign(CAMPAIGN, CREATOR, "replacement");
        vm.prank(address(timelock));
        registry.setCreatorActive(CREATOR, false);
        vm.prank(registrar);
        vm.expectRevert(ByUsPublicContextRegistryV3.InvalidContext.selector);
        registry.registerCampaign(keccak256("new"), CREATOR, "new");
    }
}
