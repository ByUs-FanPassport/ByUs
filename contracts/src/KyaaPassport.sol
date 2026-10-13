// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ByUsPassport } from "./ByUsPassport.sol";

contract KyaaPassport is ByUsPassport {
    constructor(address initialAdmin, address initialMinter)
        ByUsPassport(initialAdmin, initialMinter)
    { }

    function name() public pure override returns (string memory) {
        return "kyaa Fan Passport";
    }

    function symbol() public pure override returns (string memory) {
        return "KYAAPASS";
    }
}
