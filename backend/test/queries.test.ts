import { describe, it, expect, beforeEach } from "vitest";
import {
  getAccountsByMaster,
  getAccountByAddress,
  getAllAccounts,
  getAccountCount,
  insertAccount,
  markDeployed,
  insertAccountsBatch,
  insertSweepEvent,
  getStats,
  atomicCreateAccounts,
} from "../src/db/queries";
import { getDb } from "../src/db/schema";

// Tests use in-memory DB via DB_PATH=:memory: set in test/setup.ts.
// We need to clear tables between tests since the in-memory DB persists
// within a single vitest worker.

function clearTables() {
  const db = getDb();
  db.exec("DELETE FROM sweep_events");
  db.exec("DELETE FROM virtual_accounts");
}

beforeEach(() => clearTables());

describe("insertAccount + getAccountByAddress", () => {
  it("inserts and retrieves a single account", () => {
    const acct = insertAccount("0xABCD0001", "0xCLONE0001", 0);
    expect(acct.master).toBe("0xabcd0001");
    expect(acct.address).toBe("0xclone0001");
    expect(acct.account_index).toBe(0);
    expect(acct.deployed).toBe(0);
    expect(acct.created_at).toBeTruthy();

    const found = getAccountByAddress("0xCLONE0001");
    expect(found).toBeDefined();
    expect(found!.master).toBe("0xabcd0001");
  });

  it("returns undefined for unknown address", () => {
    expect(getAccountByAddress("0xnotexist")).toBeUndefined();
  });

  it("lowercases addresses on insert", () => {
    insertAccount("0xABCD", "0xEFGH", 0);
    const acct = getAccountByAddress("0xefgh");
    expect(acct).toBeDefined();
    expect(acct!.master).toBe("0xabcd");
  });
});

describe("getAccountsByMaster", () => {
  it("returns accounts ordered by index", () => {
    insertAccount("0xmaster1", "0xclone_b", 1);
    insertAccount("0xmaster1", "0xclone_a", 0);
    const accounts = getAccountsByMaster("0xMaster1");
    expect(accounts).toHaveLength(2);
    expect(accounts[0].account_index).toBe(0);
    expect(accounts[1].account_index).toBe(1);
  });

  it("returns empty array for unknown master", () => {
    expect(getAccountsByMaster("0xunknown")).toEqual([]);
  });
});

describe("getAllAccounts", () => {
  it("returns all accounts across masters", () => {
    insertAccount("0xm1", "0xc1", 0);
    insertAccount("0xm2", "0xc2", 0);
    expect(getAllAccounts()).toHaveLength(2);
  });

  it("returns empty when no accounts exist", () => {
    expect(getAllAccounts()).toEqual([]);
  });
});

describe("getAccountCount", () => {
  it("counts per master", () => {
    insertAccount("0xm1", "0xc1", 0);
    insertAccount("0xm1", "0xc2", 1);
    insertAccount("0xm2", "0xc3", 0);
    expect(getAccountCount("0xM1")).toBe(2);
    expect(getAccountCount("0xM2")).toBe(1);
    expect(getAccountCount("0xM3")).toBe(0);
  });
});

describe("markDeployed", () => {
  it("sets deployed flag to 1", () => {
    insertAccount("0xm1", "0xclone1", 0);
    markDeployed("0xClone1");
    const acct = getAccountByAddress("0xclone1");
    expect(acct!.deployed).toBe(1);
  });

  it("is a no-op for unknown address", () => {
    markDeployed("0xnonexistent");
  });
});

describe("insertAccountsBatch", () => {
  it("inserts multiple accounts atomically", () => {
    const results = insertAccountsBatch([
      { master: "0xm1", address: "0xb1", accountIndex: 0 },
      { master: "0xm1", address: "0xb2", accountIndex: 1 },
      { master: "0xm1", address: "0xb3", accountIndex: 2 },
    ]);
    expect(results).toHaveLength(3);
    expect(getAllAccounts()).toHaveLength(3);
  });

  it("rolls back on duplicate address", () => {
    insertAccount("0xm1", "0xexisting", 0);
    expect(() =>
      insertAccountsBatch([
        { master: "0xm1", address: "0xnew1", accountIndex: 1 },
        { master: "0xm1", address: "0xexisting", accountIndex: 2 },
      ])
    ).toThrow();
    // Transaction rolled back — only the original account exists
    expect(getAllAccounts()).toHaveLength(1);
  });
});

describe("atomicCreateAccounts", () => {
  it("creates accounts within limit", () => {
    const result = atomicCreateAccounts(
      "0xm1",
      [
        { master: "0xm1", address: "0xa1", accountIndex: 0 },
        { master: "0xm1", address: "0xa2", accountIndex: 1 },
      ],
      5
    );
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(2);
  });

  it("returns null when exceeding limit", () => {
    insertAccount("0xm1", "0xpre1", 0);
    insertAccount("0xm1", "0xpre2", 1);
    insertAccount("0xm1", "0xpre3", 2);
    insertAccount("0xm1", "0xpre4", 3);

    const result = atomicCreateAccounts(
      "0xm1",
      [
        { master: "0xm1", address: "0xa5", accountIndex: 4 },
        { master: "0xm1", address: "0xa6", accountIndex: 5 },
      ],
      5
    );
    expect(result).toBeNull();
    expect(getAllAccounts()).toHaveLength(4);
  });
});

describe("insertSweepEvent + getStats", () => {
  it("inserts sweep events and aggregates stats", () => {
    insertAccount("0xm1", "0xc1", 0);
    markDeployed("0xc1");
    insertAccount("0xm1", "0xc2", 1);
    insertAccount("0xm2", "0xc3", 0);

    insertSweepEvent("0xc1", "0xm1", "0xtx1", ["POL (native)"]);
    insertSweepEvent("0xc1", "0xm1", "0xtx2", ["USDC", "WETH"]);

    const stats = getStats();
    expect(stats.totalAccounts).toBe(3);
    expect(stats.uniqueMasters).toBe(2);
    expect(stats.deployedAccounts).toBe(1);
    expect(stats.undeployedAccounts).toBe(2);
    expect(stats.totalSweeps).toBe(2);
    expect(stats.recentSweeps).toHaveLength(2);
    expect(stats.recentSweeps[0].tx_hash).toBe("0xtx2");
    expect(stats.recentSweeps[0].tokens_swept).toEqual(["USDC", "WETH"]);
    expect(stats.recentSweeps[1].tx_hash).toBe("0xtx1");
  });

  it("returns empty stats when no data exists", () => {
    const stats = getStats();
    expect(stats.totalAccounts).toBe(0);
    expect(stats.uniqueMasters).toBe(0);
    expect(stats.totalSweeps).toBe(0);
    expect(stats.recentSweeps).toEqual([]);
  });

  it("limits recentSweeps to 10", () => {
    insertAccount("0xm1", "0xc1", 0);
    for (let i = 0; i < 15; i++) {
      insertSweepEvent("0xc1", "0xm1", `0xtx${i}`, ["TOKEN"]);
    }
    const stats = getStats();
    expect(stats.totalSweeps).toBe(15);
    expect(stats.recentSweeps).toHaveLength(10);
  });

  it("lowercases addresses in sweep events", () => {
    insertSweepEvent("0xABCD", "0xMASTER", "0xhash", ["POL"]);
    const stats = getStats();
    expect(stats.recentSweeps[0].account_address).toBe("0xabcd");
    expect(stats.recentSweeps[0].master).toBe("0xmaster");
  });
});
