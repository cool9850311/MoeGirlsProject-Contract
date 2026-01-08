// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ISafeDefinitions.sol";

contract SafeSetupHelper {
    function enableModule(address module) external {
        ISafe(address(this)).enableModule(module);
    }
}
