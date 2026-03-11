import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing sweep module
vi.mock("../src/services/indexer", () => ({
  getBalances: vi.fn(),
  getTokenSymbol: vi.fn((addr: string) => addr),
  groupBalancesByAddress: vi.fn(),
  getWhitelistCount: vi.fn().mockReturnValue(0),
}));

vi.mock("../src/services/chain", () => ({
  publicClient: {},
  walletClient: {},
  gasAccountAddress: "0x0000000000000000000000000000000000000099",
  factoryABI: [],
  implABI: [],
  getVirtualAddress: vi.fn(),
  sendDeployAndSweep: vi.fn(),
  sendSweepAll: vi.fn(),
  queueTransaction: vi.fn(),
  getGasBalance: vi.fn().mockResolvedValue(BigInt("10000000000000000000")),
  getLastGasBalance: vi.fn().mockReturnValue(BigInt("10000000000000000000")),
  getQueueDepth: vi.fn().mockReturnValue(0),
}));

vi.mock("../src/db/queries", () => ({
  markDeployed: vi.fn(),
  insertSweepEvent: vi.fn(),
}));

import { sweepAccount } from "../src/services/sweep";
import { getBalances, getTokenSymbol } from "../src/services/indexer";
import { sendDeployAndSweep, sendSweepAll } from "../src/services/chain";
import { markDeployed, insertSweepEvent } from "../src/db/queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sweepAccount", () => {
  const addr = "0xclone0001";
  const master = "0xmaster0001";

  it("returns swept:false when no balances", async () => {
    vi.mocked(getBalances).mockResolvedValue([]);
    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.swept).toBe(false);
    expect(result.tokens).toEqual([]);
  });

  it("returns swept:false when balances are null", async () => {
    vi.mocked(getBalances).mockResolvedValue(null as any);
    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.swept).toBe(false);
  });

  it("returns swept:false when all balances are zero", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "0x0000000000000000000000000000000000000000", accountAddress: addr, balance: "0" },
      { contractAddress: "0xtoken1", accountAddress: addr, balance: "0" },
    ]);
    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.swept).toBe(false);
    expect(result.tokens).toEqual([]);
  });

  it("calls deployAndSweep when not deployed", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "0x0000000000000000000000000000000000000000", accountAddress: addr, balance: "1000000000000000000" },
    ]);
    vi.mocked(sendDeployAndSweep).mockResolvedValue("0xtxhash1" as `0x${string}`);

    const result = await sweepAccount(addr, master, 0, 0);

    expect(result.swept).toBe(true);
    expect(result.txHash).toBe("0xtxhash1");
    expect(result.tokens).toEqual(["POL (native)"]);
    expect(sendDeployAndSweep).toHaveBeenCalledOnce();
    expect(sendSweepAll).not.toHaveBeenCalled();
    expect(markDeployed).toHaveBeenCalledWith(addr);
    expect(insertSweepEvent).toHaveBeenCalledWith(addr, master, "0xtxhash1", ["POL (native)"]);
  });

  it("calls sweepAll when already deployed", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "0xtoken1", accountAddress: addr, balance: "500" },
    ]);
    vi.mocked(sendSweepAll).mockResolvedValue("0xtxhash2" as `0x${string}`);

    const result = await sweepAccount(addr, master, 0, 1);

    expect(result.swept).toBe(true);
    expect(sendSweepAll).toHaveBeenCalledOnce();
    expect(sendDeployAndSweep).not.toHaveBeenCalled();
    expect(markDeployed).not.toHaveBeenCalled();
    expect(insertSweepEvent).toHaveBeenCalledWith(addr, master, "0xtxhash2", ["0xtoken1"]);
  });

  it("detects native POL via zero address", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "0x0000000000000000000000000000000000000000", accountAddress: addr, balance: "1" },
    ]);
    vi.mocked(sendDeployAndSweep).mockResolvedValue("0xh" as `0x${string}`);

    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.tokens).toEqual(["POL (native)"]);
  });

  it("detects native POL via empty string", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "", accountAddress: addr, balance: "1" },
    ]);
    vi.mocked(sendDeployAndSweep).mockResolvedValue("0xh" as `0x${string}`);

    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.tokens).toEqual(["POL (native)"]);
  });

  it("deduplicates tokens", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "0xtoken1", accountAddress: addr, balance: "100" },
      { contractAddress: "0xTOKEN1", accountAddress: addr, balance: "200" }, // same, different case
      { contractAddress: "0x0000000000000000000000000000000000000000", accountAddress: addr, balance: "50" },
      { contractAddress: "", accountAddress: addr, balance: "50" }, // duplicate native
    ]);
    vi.mocked(sendDeployAndSweep).mockResolvedValue("0xh" as `0x${string}`);

    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.tokens).toEqual(["0xtoken1", "POL (native)"]);
  });

  it("handles mixed POL + ERC20 tokens", async () => {
    vi.mocked(getBalances).mockResolvedValue([
      { contractAddress: "0x0000000000000000000000000000000000000000", accountAddress: addr, balance: "1000" },
      { contractAddress: "0xusdc", accountAddress: addr, balance: "500" },
      { contractAddress: "0xweth", accountAddress: addr, balance: "300" },
    ]);
    vi.mocked(sendDeployAndSweep).mockResolvedValue("0xh" as `0x${string}`);

    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.tokens).toHaveLength(3);
    expect(result.tokens).toContain("POL (native)");
  });

  it("concurrency guard prevents double sweep", async () => {
    // Create a long-running sweep
    let resolveSweep!: () => void;
    vi.mocked(getBalances).mockReturnValue(
      new Promise((resolve) => {
        resolveSweep = () =>
          resolve([
            { contractAddress: "0xtoken1", accountAddress: addr, balance: "100" },
          ]);
      })
    );

    const promise1 = sweepAccount(addr, master, 0, 1);
    // Second call while first is in progress
    const result2 = await sweepAccount(addr, master, 0, 1);
    expect(result2.swept).toBe(false);
    expect(result2.skipped).toBe("Sweep already in progress");

    // Resolve the first sweep to clean up
    vi.mocked(sendSweepAll).mockResolvedValue("0xh" as `0x${string}`);
    resolveSweep();
    await promise1;
  });

  it("cleans up concurrency guard on error", async () => {
    vi.mocked(getBalances).mockRejectedValueOnce(new Error("indexer down"));

    await expect(sweepAccount(addr, master, 0, 0)).rejects.toThrow("indexer down");

    // Should be able to sweep again after error
    vi.mocked(getBalances).mockResolvedValue([]);
    const result = await sweepAccount(addr, master, 0, 0);
    expect(result.swept).toBe(false); // no balances, but no "already in progress"
    expect(result.skipped).toBeUndefined();
  });
});
