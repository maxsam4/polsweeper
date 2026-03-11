// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VirtualAccountCreator} from "../src/VirtualAccountCreator.sol";
import {VirtualAccountImpl} from "../src/VirtualAccountImpl.sol";

/// @title Deploy
/// @notice Deploys VirtualAccountImpl and VirtualAccountCreator to Polygon.
/// @dev    Solves the chicken-and-egg problem: impl needs factory address,
///         factory needs impl address. We predict the factory address from
///         the deployer nonce, deploy impl with that predicted address, then
///         deploy the factory and verify the prediction matched.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Predict factory address: impl deploys at current nonce,
        // factory deploys at current nonce + 1
        uint64 nonce = vm.getNonce(deployer);
        address predictedFactory = vm.computeCreateAddress(deployer, nonce + 1);

        // Deploy impl with predicted factory address
        VirtualAccountImpl impl = new VirtualAccountImpl(predictedFactory);
        console.log("VirtualAccountImpl deployed at:", address(impl));

        // Deploy factory with impl address
        VirtualAccountCreator factory = new VirtualAccountCreator(address(impl));
        console.log("VirtualAccountCreator deployed at:", address(factory));

        // Verify prediction
        require(address(factory) == predictedFactory, "Factory address mismatch");
        console.log("Factory address verified");

        vm.stopBroadcast();
    }
}
