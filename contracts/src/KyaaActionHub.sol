// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ByUsActionHub } from "./ByUsActionHub.sol";
import { KyaaPassport } from "./KyaaPassport.sol";
import { KyaaStamp } from "./KyaaStamp.sol";

contract KyaaActionHub is ByUsActionHub {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _expectedHub;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _governance;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _kyaaPassport;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _kyaaStamp;

    error InvalidKyaaBinding();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address expectedHub, address passport, address stamp) {
        if (expectedHub.code.length == 0 || passport.code.length == 0 || stamp.code.length == 0) {
            revert InvalidKyaaBinding();
        }
        address governance = KyaaPassport(passport).defaultAdmin();
        if (
            !_isValidTimelock(governance) || KyaaStamp(stamp).defaultAdmin() != governance
                || !KyaaPassport(passport).hasRole(keccak256("MINTER_ROLE"), expectedHub)
                || !KyaaStamp(stamp).hasRole(keccak256("MINTER_ROLE"), expectedHub)
                || ByUsActionHub(expectedHub).getAssetBinding(1, CredentialKind.PASSPORT)
                    == passport
                || ByUsActionHub(expectedHub).getAssetBinding(1, CredentialKind.STAMP) == stamp
        ) revert InvalidKyaaBinding();
        _expectedHub = expectedHub;
        _governance = governance;
        _kyaaPassport = passport;
        _kyaaStamp = stamp;
    }

    // Version 2 is reserved by the earlier context-registry upgrade.
    function initializeKyaaBinding()
        external
        onlyProxy
        onlyRole(DEFAULT_ADMIN_ROLE)
        reinitializer(3)
    {
        if (address(this) != _expectedHub || msg.sender != _governance) revert InvalidKyaaBinding();
        emit AssetBindingRegistered(2, CredentialKind.PASSPORT, _kyaaPassport);
        emit AssetBindingRegistered(2, CredentialKind.STAMP, _kyaaStamp);
    }

    function getAssetBinding(uint32 version, CredentialKind kind)
        public
        view
        override
        returns (address)
    {
        if (version != 2) return super.getAssetBinding(version, kind);
        if (_getInitializedVersion() < 3) return address(0);
        if (kind == CredentialKind.PASSPORT) return _kyaaPassport;
        if (kind == CredentialKind.STAMP) return _kyaaStamp;
        return address(0);
    }
}
