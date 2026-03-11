// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {VirtualAccountImpl} from "./VirtualAccountImpl.sol";

/// @title VirtualAccountCreator
/// @notice Permissionless factory that deploys deterministic EIP-1167 minimal-proxy
///         "virtual accounts" and sweeps their balances to a master address.
contract VirtualAccountCreator {
    using Clones for address;

    // ── State ────────────────────────────────────────────────────────────

    /// @notice The implementation contract all clones delegate to.
    address public immutable implementation;

    /// @notice Maps each deployed clone to its master (owner) address.
    mapping(address => address) public masterOf;

    // ── Events ───────────────────────────────────────────────────────────

    event AccountDeployed(address indexed master, uint256 index, address clone);

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(address _implementation) {
        require(_implementation != address(0), "impl = zero");
        implementation = _implementation;
    }

    // ── Public / External ────────────────────────────────────────────────

    /// @notice Deploy a clone (if needed) for `master` at `index`, then sweep
    ///         the given tokens (plus native POL) to the master.
    /// @param master  The address that receives swept funds.
    /// @param index   A user-chosen nonce so one master can have many accounts.
    /// @param tokens  ERC-20 token addresses to sweep.
    function deployAndSweep(address master, uint256 index, address[] calldata tokens) external {
        require(master != address(0), "master = zero");
        bytes32 salt = keccak256(abi.encode(master, index));
        address predicted = implementation.predictDeterministicAddress(salt, address(this));

        // Deploy clone if it doesn't exist yet
        if (predicted.code.length == 0) {
            address clone = implementation.cloneDeterministic(salt);
            masterOf[clone] = master;
            emit AccountDeployed(master, index, clone);
        }

        // Sweep regardless of whether we just deployed or not
        VirtualAccountImpl(payable(predicted)).sweepAll(tokens);
    }

    /// @notice Predict the deterministic address for a (master, index) pair.
    /// @param master  The master address.
    /// @param index   The index nonce.
    /// @return The predicted clone address.
    function getAddress(address master, uint256 index) external view returns (address) {
        bytes32 salt = keccak256(abi.encode(master, index));
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    /// @notice Batch-predict addresses for a range of indices.
    /// @param master  The master address.
    /// @param start   First index (inclusive).
    /// @param count   How many addresses to return.
    /// @return addrs  Array of predicted clone addresses.
    function getAddresses(address master, uint256 start, uint256 count)
        external
        view
        returns (address[] memory addrs)
    {
        addrs = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            bytes32 salt = keccak256(abi.encode(master, start + i));
            addrs[i] = implementation.predictDeterministicAddress(salt, address(this));
        }
    }
}
