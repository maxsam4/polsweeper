import { describe, it, expect } from "vitest";
import { groupBalancesByAddress, type TokenBalance } from "../src/services/indexer";

// Note: getTokenSymbol, getWhitelistCount, getTokenInfo depend on the whitelist
// file loaded at module init. We test groupBalancesByAddress which is pure logic.

describe("groupBalancesByAddress", () => {
  it("groups balances by account address", () => {
    const balances: TokenBalance[] = [
      { contractAddress: "0xtoken1", accountAddress: "0xAccount1", balance: "100" },
      { contractAddress: "0xtoken2", accountAddress: "0xAccount1", balance: "200" },
      { contractAddress: "0xtoken1", accountAddress: "0xAccount2", balance: "300" },
    ];

    const grouped = groupBalancesByAddress(balances);
    expect(grouped.size).toBe(2);
    expect(grouped.get("0xaccount1")).toHaveLength(2);
    expect(grouped.get("0xaccount2")).toHaveLength(1);
  });

  it("lowercases account addresses as keys", () => {
    const balances: TokenBalance[] = [
      { contractAddress: "0xtoken1", accountAddress: "0xABCD", balance: "100" },
    ];
    const grouped = groupBalancesByAddress(balances);
    expect(grouped.has("0xabcd")).toBe(true);
    expect(grouped.has("0xABCD")).toBe(false);
  });

  it("returns empty map for empty input", () => {
    const grouped = groupBalancesByAddress([]);
    expect(grouped.size).toBe(0);
  });

  it("handles single balance entry", () => {
    const balances: TokenBalance[] = [
      { contractAddress: "0xtoken1", accountAddress: "0xonly1", balance: "1" },
    ];
    const grouped = groupBalancesByAddress(balances);
    expect(grouped.size).toBe(1);
    expect(grouped.get("0xonly1")![0].balance).toBe("1");
  });
});
