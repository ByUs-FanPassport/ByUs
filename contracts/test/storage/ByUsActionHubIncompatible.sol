// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @dev Deliberately incompatible fixture used by scripts/verify-storage.sh.
contract ByUsActionHubIncompatible is Initializable, UUPSUpgradeable {
    /// @custom:storage-location erc7201:byus.storage.ActionHub
    struct HubStorage {
        address eas;
        bytes32 environmentId;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer { }

    function _authorizeUpgrade(address) internal override { }
}
