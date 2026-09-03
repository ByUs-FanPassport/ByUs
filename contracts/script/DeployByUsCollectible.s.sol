// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { ByUsCollectible } from "../src/ByUsCollectible.sol";

contract DeployByUsCollectible is Script {
    function run() external returns (ByUsCollectible collectible) {
        uint256 deployerKey = vm.envUint("GIWA_RELAYER_PRIVATE_KEY");
        address admin = vm.envAddress("BYUS_ADMIN_ADDRESS");
        address relayer = vm.envAddress("BYUS_RELAYER_ADDRESS");
        vm.startBroadcast(deployerKey);
        collectible = new ByUsCollectible(admin, relayer);
        vm.stopBroadcast();
    }
}
