// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {VirtualAccountCreator} from "./VirtualAccountCreator.sol";

/// @title VirtualAccountImpl
/// @notice Implementation contract for virtual-account clones.  Each clone
///         forwards all funds (native POL + ERC-20 tokens) to the master
///         address stored in the factory's `masterOf` mapping.
/// @dev    Because `factory` is an immutable, it lives in the runtime bytecode
///         and is therefore available in every EIP-1167 clone via delegatecall.
contract VirtualAccountImpl {
    using SafeERC20 for IERC20;

    // ── State ────────────────────────────────────────────────────────────

    /// @notice The factory that deployed this clone (immutable, in bytecode).
    VirtualAccountCreator public immutable factory;

    // ── Events ───────────────────────────────────────────────────────────

    /// @notice Emitted for every successful sweep.
    /// @param master The recipient of the swept funds.
    /// @param token  The token address (address(0) for native POL).
    /// @param amount The amount swept.
    event Swept(address indexed master, address indexed token, uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(address _factory) {
        factory = VirtualAccountCreator(_factory);
    }

    // ── External ─────────────────────────────────────────────────────────

    /// @notice Sweep native POL and a list of ERC-20 tokens to master.
    /// @param tokens ERC-20 addresses to sweep. Bad/reverting tokens are
    ///              silently skipped so they never block the POL sweep.
    function sweepAll(address[] calldata tokens) external {
        address master = _getMaster();

        // Sweep native POL
        uint256 polBalance = address(this).balance;
        if (polBalance > 0) {
            (bool ok,) = master.call{value: polBalance}("");
            require(ok, "POL transfer failed");
            emit Swept(master, address(0), polBalance);
        }

        // Sweep each ERC-20 (skip failures)
        for (uint256 i = 0; i < tokens.length; i++) {
            try this._sweepOneToken(tokens[i]) {}
            catch {}
        }
    }

    /// @notice Sweep only native POL to master.
    function sweepPOL() external {
        address master = _getMaster();
        uint256 polBalance = address(this).balance;
        if (polBalance > 0) {
            (bool ok,) = master.call{value: polBalance}("");
            require(ok, "POL transfer failed");
            emit Swept(master, address(0), polBalance);
        }
    }

    /// @notice Sweep a single ERC-20 token to master.
    /// @param token The ERC-20 token address.
    function sweepERC20(address token) external {
        address master = _getMaster();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(master, balance);
            emit Swept(master, token, balance);
        }
    }

    /// @notice Called externally by `sweepAll` via `this._sweepOneToken` so
    ///         that try/catch can capture reverts from bad tokens.
    /// @dev    Validates master against factory to prevent fund redirection.
    function _sweepOneToken(address token) external {
        address master = _getMaster();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(master, balance);
            emit Swept(master, token, balance);
        }
    }

    /// @notice Accept native POL deposits.
    receive() external payable {}

    // ── Internal ─────────────────────────────────────────────────────────

    /// @dev Reads the master address from the factory's `masterOf` mapping.
    function _getMaster() internal view returns (address master) {
        master = factory.masterOf(address(this));
        require(master != address(0), "not initialized");
    }
}
