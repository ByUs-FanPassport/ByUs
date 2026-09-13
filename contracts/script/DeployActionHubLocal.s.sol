// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { ByUsActionCodec } from "../src/ByUsActionCodec.sol";
import { ByUsPublicContextRegistry } from "../src/ByUsPublicContextRegistry.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";
import { ByUsCollectible } from "../src/ByUsCollectible.sol";
import { MockEAS } from "../src/mocks/MockEAS.sol";

contract DeployActionHubLocal is Script {
    uint256 internal constant DEFAULT_ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant ANVIL_MIGRATOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ANVIL_CORRECTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant ANVIL_PAUSER = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    struct Deployment {
        address hub;
        address implementation;
        address codec;
        address eas;
        address passport;
        address stamp;
        address collectible;
        address timelock;
        address contextRegistry;
        address writer;
    }

    function run() external returns (Deployment memory deployment) {
        require(block.chainid == 31337, "LOCAL_CHAIN_ONLY");
        uint256 deployerKey = vm.envOr("ANVIL_PRIVATE_KEY", DEFAULT_ANVIL_PRIVATE_KEY);
        address writer = vm.addr(deployerKey);
        bytes32 environmentId = vm.envOr("BYUS_ENVIRONMENT_ID", keccak256("ANVIL_LOCAL"));
        bytes32 schemaUID = vm.envOr("BYUS_ACTION_SCHEMA_UID", keccak256("BYUS_ACTION_V1"));

        vm.startBroadcast(deployerKey);
        address[] memory proposers = new address[](1);
        proposers[0] = writer;
        address[] memory executors = new address[](1);
        executors[0] = writer;
        TimelockController timelock =
            new TimelockController(2 days, proposers, executors, address(0));
        ByUsPublicContextRegistry contextRegistry = new ByUsPublicContextRegistry(address(timelock));
        MockEAS eas = new MockEAS();
        ByUsPassport passport = new ByUsPassport(writer, writer);
        ByUsStamp stamp = new ByUsStamp(writer, writer);
        ByUsCollectible collectible = new ByUsCollectible(writer, writer);
        ByUsActionCodec codec = new ByUsActionCodec();
        ByUsActionHub implementation = new ByUsActionHub();
        ByUsActionHub.InitializationConfig memory config = ByUsActionHub.InitializationConfig({
            admin: address(timelock),
            writer: writer,
            migrator: ANVIL_MIGRATOR,
            corrector: ANVIL_CORRECTOR,
            pauser: ANVIL_PAUSER,
            easAddress: address(eas),
            environmentId: environmentId,
            schemaUID: schemaUID,
            passport: address(passport),
            stamp: address(stamp),
            collectible: address(collectible),
            codec: address(codec),
            contextRegistry: address(contextRegistry)
        });
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(ByUsActionHub.initialize, config)
        );
        ByUsActionHub hub = ByUsActionHub(address(proxy));
        passport.grantRole(passport.MINTER_ROLE(), address(hub));
        stamp.grantRole(stamp.MINTER_ROLE(), address(hub));
        collectible.grantRole(collectible.MINTER_ROLE(), address(hub));
        vm.stopBroadcast();

        deployment = Deployment({
            hub: address(hub),
            implementation: address(implementation),
            codec: address(codec),
            eas: address(eas),
            passport: address(passport),
            stamp: address(stamp),
            collectible: address(collectible),
            timelock: address(timelock),
            contextRegistry: address(contextRegistry),
            writer: writer
        });
        console2.log("BYUS_HUB", deployment.hub);
        console2.log("BYUS_IMPLEMENTATION", deployment.implementation);
        console2.log("BYUS_CODEC", deployment.codec);
        console2.log("BYUS_EAS", deployment.eas);
        console2.log("BYUS_PASSPORT", deployment.passport);
        console2.log("BYUS_STAMP", deployment.stamp);
        console2.log("BYUS_COLLECTIBLE", deployment.collectible);
        console2.log("BYUS_TIMELOCK", deployment.timelock);
        console2.log("BYUS_CONTEXT_REGISTRY", deployment.contextRegistry);
        console2.log("BYUS_WRITER", deployment.writer);
    }
}
