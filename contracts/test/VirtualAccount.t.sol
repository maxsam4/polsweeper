// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {VirtualAccountCreator} from "../src/VirtualAccountCreator.sol";
import {VirtualAccountImpl} from "../src/VirtualAccountImpl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ─── Mock tokens ─────────────────────────────────────────────────────────────

/// @dev A trivially simple ERC-20 with public `mint`.
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not allowed");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev An ERC-20 that always reverts on `transfer` and `balanceOf`.
contract RevertingERC20 {
    function balanceOf(address) external pure returns (uint256) {
        revert("always reverts");
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("always reverts");
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("always reverts");
    }

    function approve(address, uint256) external pure returns (bool) {
        revert("always reverts");
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

contract VirtualAccountTest is Test {
    VirtualAccountCreator public creator;
    VirtualAccountImpl public impl;

    MockERC20 public tokenA;
    MockERC20 public tokenB;
    RevertingERC20 public badToken;

    address public master = makeAddr("master");

    // Events (re-declared for expectEmit)
    event AccountDeployed(address indexed master, uint256 index, address clone);
    event Swept(address indexed master, address indexed token, uint256 amount);

    function setUp() public {
        // Deploy implementation with factory = address(0) temporarily
        // We need the real factory address, which is a chicken-and-egg.
        // Solution: predict the factory address, deploy impl with it, then deploy factory.

        // Step 1: Figure out the factory's future address.
        // The factory will be deployed by this test contract (address(this)) at its current nonce.
        // Current nonce: we haven't deployed anything yet, so nonce = 0 was setUp's own frame.
        // Actually in Foundry tests, deployments increment the test contract's nonce.
        // Let's just deploy in the right order: impl first (with placeholder), then factory,
        // then re-deploy impl with real factory. But that wastes gas and is ugly.
        //
        // Cleaner: compute the factory address in advance.
        //
        // Nonce for address(this):
        //   - nonce 1 -> impl deployment
        //   - nonce 2 -> factory deployment
        // So factory address = addressFrom(address(this), 2)
        //
        // But Foundry's nonce tracking may differ. Let's use vm.computeCreateAddress.

        uint64 implNonce = vm.getNonce(address(this));
        // impl will be deployed at nonce implNonce
        // factory will be deployed at nonce implNonce + 1
        address futureFactory = vm.computeCreateAddress(address(this), implNonce + 1);

        impl = new VirtualAccountImpl(futureFactory);
        creator = new VirtualAccountCreator(address(impl));

        // Verify our prediction was correct
        require(address(creator) == futureFactory, "factory address mismatch");

        // Deploy mock tokens
        tokenA = new MockERC20("Token A", "TKNA");
        tokenB = new MockERC20("Token B", "TKNB");
        badToken = new RevertingERC20();
    }

    // ── Test: getAddress matches actual deployed clone ───────────────────

    function test_getAddress_matches_deployed_clone() public {
        address predicted = creator.getAddress(master, 0);

        address[] memory tokens = new address[](0);
        creator.deployAndSweep(master, 0, tokens);

        // The clone should now be deployed at the predicted address
        assertTrue(predicted.code.length > 0, "clone not deployed");
        assertEq(creator.masterOf(predicted), master, "masterOf mismatch");
    }

    // ── Test: deployAndSweep deploys + sweeps POL ────────────────────────

    function test_deployAndSweep_deploys_and_sweeps_POL() public {
        address predicted = creator.getAddress(master, 0);

        // Send POL to predicted address before deployment
        vm.deal(predicted, 1 ether);
        assertEq(predicted.balance, 1 ether);

        uint256 masterBalBefore = master.balance;

        address[] memory tokens = new address[](0);

        vm.expectEmit(true, false, false, true);
        emit AccountDeployed(master, 0, predicted);

        vm.expectEmit(true, true, false, true);
        emit Swept(master, address(0), 1 ether);

        creator.deployAndSweep(master, 0, tokens);

        assertEq(predicted.balance, 0, "clone should have 0 POL");
        assertEq(master.balance, masterBalBefore + 1 ether, "master should receive POL");
    }

    // ── Test: deployAndSweep deploys + sweeps ERC20 ──────────────────────

    function test_deployAndSweep_deploys_and_sweeps_ERC20() public {
        address predicted = creator.getAddress(master, 0);

        // Mint ERC20 to predicted address before deployment
        tokenA.mint(predicted, 500e18);
        assertEq(tokenA.balanceOf(predicted), 500e18);

        address[] memory tokens = new address[](1);
        tokens[0] = address(tokenA);

        vm.expectEmit(true, true, false, true);
        emit Swept(master, address(tokenA), 500e18);

        creator.deployAndSweep(master, 0, tokens);

        assertEq(tokenA.balanceOf(predicted), 0, "clone should have 0 tokenA");
        assertEq(tokenA.balanceOf(master), 500e18, "master should receive tokenA");
    }

    // ── Test: sweepAll with mixed POL + ERC20 ────────────────────────────

    function test_sweepAll_mixed_POL_and_ERC20() public {
        address predicted = creator.getAddress(master, 1);

        // Deploy clone first (empty sweep)
        address[] memory empty = new address[](0);
        creator.deployAndSweep(master, 1, empty);

        // Now fund the clone with POL + two tokens
        vm.deal(predicted, 2 ether);
        tokenA.mint(predicted, 100e18);
        tokenB.mint(predicted, 200e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        VirtualAccountImpl(payable(predicted)).sweepAll(tokens);

        assertEq(predicted.balance, 0, "POL not swept");
        assertEq(tokenA.balanceOf(predicted), 0, "tokenA not swept");
        assertEq(tokenB.balanceOf(predicted), 0, "tokenB not swept");
        assertEq(master.balance, 2 ether, "master POL mismatch");
        assertEq(tokenA.balanceOf(master), 100e18, "master tokenA mismatch");
        assertEq(tokenB.balanceOf(master), 200e18, "master tokenB mismatch");
    }

    // ── Test: sweepAll resilience — reverting ERC20 doesn't block POL ────

    function test_sweepAll_resilience_bad_token_skipped() public {
        address predicted = creator.getAddress(master, 2);

        // Deploy clone
        address[] memory empty = new address[](0);
        creator.deployAndSweep(master, 2, empty);

        // Fund with POL + good token + bad token
        vm.deal(predicted, 3 ether);
        tokenA.mint(predicted, 50e18);

        address[] memory tokens = new address[](3);
        tokens[0] = address(tokenA);
        tokens[1] = address(badToken); // will revert — should be skipped
        tokens[2] = address(tokenA); // duplicate, balance is 0 now, should be fine

        VirtualAccountImpl(payable(predicted)).sweepAll(tokens);

        assertEq(predicted.balance, 0, "POL not swept");
        assertEq(tokenA.balanceOf(predicted), 0, "tokenA not swept");
        assertEq(master.balance, 3 ether, "master POL mismatch");
        assertEq(tokenA.balanceOf(master), 50e18, "master tokenA mismatch");
    }

    // ── Test: require(master != address(0)) guard ────────────────────────

    function test_revert_when_master_not_initialized() public {
        // Deploy a clone without going through the factory (masterOf not set)
        // We'll just call sweepAll on the implementation itself
        address[] memory tokens = new address[](0);

        vm.expectRevert("not initialized");
        impl.sweepAll(tokens);
    }

    function test_revert_sweepPOL_when_not_initialized() public {
        vm.expectRevert("not initialized");
        impl.sweepPOL();
    }

    function test_revert_sweepERC20_when_not_initialized() public {
        vm.expectRevert("not initialized");
        impl.sweepERC20(address(tokenA));
    }

    // ── Test: second deployAndSweep (already deployed) still sweeps ─────

    function test_second_deployAndSweep_still_sweeps() public {
        address predicted = creator.getAddress(master, 3);

        // First call: deploy + sweep (nothing to sweep)
        address[] memory empty = new address[](0);
        creator.deployAndSweep(master, 3, empty);
        assertTrue(predicted.code.length > 0, "clone should be deployed");

        // Fund again
        vm.deal(predicted, 5 ether);
        tokenA.mint(predicted, 1000e18);

        address[] memory tokens = new address[](1);
        tokens[0] = address(tokenA);

        // Second call: should NOT deploy again, but still sweep
        creator.deployAndSweep(master, 3, tokens);

        assertEq(predicted.balance, 0, "POL not swept on 2nd call");
        assertEq(tokenA.balanceOf(predicted), 0, "tokenA not swept on 2nd call");
        assertEq(master.balance, 5 ether, "master POL mismatch");
        assertEq(tokenA.balanceOf(master), 1000e18, "master tokenA mismatch");
    }

    // ── Test: funds sent before deploy are swept after deploy ────────────

    function test_funds_before_deploy_swept_after_deploy() public {
        address predicted = creator.getAddress(master, 4);

        // Send funds BEFORE the clone is deployed
        vm.deal(predicted, 10 ether);
        tokenA.mint(predicted, 777e18);
        tokenB.mint(predicted, 333e18);

        // Verify no code yet
        assertEq(predicted.code.length, 0, "should not be deployed yet");

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        // Deploy and sweep in one call
        creator.deployAndSweep(master, 4, tokens);

        assertEq(predicted.balance, 0, "POL not swept");
        assertEq(tokenA.balanceOf(predicted), 0, "tokenA not swept");
        assertEq(tokenB.balanceOf(predicted), 0, "tokenB not swept");
        assertEq(master.balance, 10 ether, "master POL mismatch");
        assertEq(tokenA.balanceOf(master), 777e18, "master tokenA mismatch");
        assertEq(tokenB.balanceOf(master), 333e18, "master tokenB mismatch");
    }

    // ── Test: getAddresses batch prediction ──────────────────────────────

    function test_getAddresses_batch() public {
        address[] memory addrs = creator.getAddresses(master, 0, 5);
        assertEq(addrs.length, 5);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(addrs[i], creator.getAddress(master, i), "batch mismatch");
        }
    }

    // ── Test: sweepPOL standalone ────────────────────────────────────────

    function test_sweepPOL_standalone() public {
        address predicted = creator.getAddress(master, 5);

        address[] memory empty = new address[](0);
        creator.deployAndSweep(master, 5, empty);

        vm.deal(predicted, 7 ether);

        VirtualAccountImpl(payable(predicted)).sweepPOL();

        assertEq(predicted.balance, 0, "POL not swept");
        assertEq(master.balance, 7 ether, "master POL mismatch");
    }

    // ── Test: sweepERC20 standalone ──────────────────────────────────────

    function test_sweepERC20_standalone() public {
        address predicted = creator.getAddress(master, 6);

        address[] memory empty = new address[](0);
        creator.deployAndSweep(master, 6, empty);

        tokenB.mint(predicted, 999e18);

        VirtualAccountImpl(payable(predicted)).sweepERC20(address(tokenB));

        assertEq(tokenB.balanceOf(predicted), 0, "tokenB not swept");
        assertEq(tokenB.balanceOf(master), 999e18, "master tokenB mismatch");
    }

    // ── Test: receive() accepts POL ──────────────────────────────────────

    function test_clone_accepts_POL() public {
        address predicted = creator.getAddress(master, 7);

        address[] memory empty = new address[](0);
        creator.deployAndSweep(master, 7, empty);

        // Send POL to the clone directly
        (bool ok,) = predicted.call{value: 1 ether}("");
        assertTrue(ok, "clone should accept POL");
        assertEq(predicted.balance, 1 ether);
    }
}
