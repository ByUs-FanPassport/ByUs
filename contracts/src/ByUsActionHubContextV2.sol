// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ByUsActionHub } from "./ByUsActionHub.sol";
import { ByUsPublicContextRegistry } from "./ByUsPublicContextRegistry.sol";
import { ByUsPublicContextRegistryV2 } from "./ByUsPublicContextRegistryV2.sol";
import { IByUsPublicContextRegistry } from "./interfaces/IByUsPublicContextRegistry.sol";

/// @dev This transition requires an empty legacy registry, checked by the rollout tool
/// immediately before scheduling and execution. V1 cannot prove emptiness onchain.
contract ByUsActionHubContextV2 is ByUsActionHub {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _previousRegistry;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _nextRegistry;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _governance;

    error InvalidRegistryTransition();
    event ContextRegistryChanged(address indexed previousRegistry, address indexed nextRegistry);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address previousRegistry, address nextRegistry) {
        if (
            previousRegistry.code.length == 0 || nextRegistry.code.length == 0
                || previousRegistry == nextRegistry
        ) revert InvalidRegistryTransition();
        address governance = ByUsPublicContextRegistry(previousRegistry).admin();
        if (
            !_isValidTimelock(governance)
                || ByUsPublicContextRegistryV2(nextRegistry).admin() != governance
        ) {
            revert InvalidRegistryTransition();
        }
        _previousRegistry = previousRegistry;
        _nextRegistry = nextRegistry;
        _governance = governance;
    }

    /// @dev Invoke atomically through the existing timelock's upgradeToAndCall.
    function migrateContextRegistry()
        external
        onlyProxy
        reinitializer(2)
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        HubStorage storage $ = _getStorage();
        if (
            msg.sender != _governance || !_isValidTimelock(msg.sender)
                || address($.contextRegistry) != _previousRegistry
        ) revert InvalidRegistryTransition();
        $.contextRegistry = IByUsPublicContextRegistry(_nextRegistry);
        emit ContextRegistryChanged(_previousRegistry, _nextRegistry);
    }

    function contextRegistry() external view returns (address) {
        return address(_getStorage().contextRegistry);
    }
}
