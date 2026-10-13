// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ByUsStamp } from "./ByUsStamp.sol";

contract KyaaStamp is ByUsStamp {
    constructor(address initialAdmin, address initialMinter)
        ByUsStamp(initialAdmin, initialMinter)
    { }
}
