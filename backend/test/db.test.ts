import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

// We test the query logic directly against an in-memory SQLite DB
// rather than importing from src/ (which triggers config.ts side effects).

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS virtual_accounts (
      id INTEGER PRIMARY KEY,
      master TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      account_index INTEGER NOT NULL,
      deployed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_master ON virtual_accounts(master);

    CREATE TABLE IF NOT EXISTS sweep_events (
      id INTEGER PRIMARY KEY,
      account_address TEXT NOT NULL,
      master TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      tokens_swept TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sweep_events_created ON sweep_events(created_at);
  `);
  return db;
}

function insertAccount(
  db: Database.Database,
  master: string,
  address: string,
  index: number,
  deployed = 0
) {
  db.prepare(
    "INSERT INTO virtual_accounts (master, address, account_index, deployed, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(master.toLowerCase(), address.toLowerCase(), index, deployed, new Date().toISOString());
}

function insertSweepEvent(
  db: Database.Database,
  accountAddress: string,
  master: string,
  txHash: string,
  tokens: string[]
) {
  db.prepare(
    "INSERT INTO sweep_events (account_address, master, tx_hash, tokens_swept, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    accountAddress.toLowerCase(),
    master.toLowerCase(),
    txHash,
    JSON.stringify(tokens),
    new Date().toISOString()
  );
}

describe("virtual_accounts table", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts and retrieves accounts by master", () => {
    const master = "0xaabbccddee0011223344556677889900aabbccdd";
    insertAccount(db, master, "0x1111111111111111111111111111111111111111", 0);
    insertAccount(db, master, "0x2222222222222222222222222222222222222222", 1);

    const rows = db
      .prepare("SELECT * FROM virtual_accounts WHERE master = ? ORDER BY account_index ASC")
      .all(master.toLowerCase());
    expect(rows).toHaveLength(2);
  });

  it("enforces unique address constraint", () => {
    const addr = "0x1111111111111111111111111111111111111111";
    insertAccount(db, "0xaaaa000000000000000000000000000000000001", addr, 0);
    expect(() =>
      insertAccount(db, "0xaaaa000000000000000000000000000000000002", addr, 0)
    ).toThrow(/UNIQUE/);
  });

  it("counts accounts per master", () => {
    const master = "0xaabbccddee0011223344556677889900aabbccdd";
    insertAccount(db, master, "0x0000000000000000000000000000000000000001", 0);
    insertAccount(db, master, "0x0000000000000000000000000000000000000002", 1);
    insertAccount(db, "0xother0000000000000000000000000000000000", "0x0000000000000000000000000000000000000003", 0);

    const row = db
      .prepare("SELECT COUNT(*) as count FROM virtual_accounts WHERE master = ?")
      .get(master.toLowerCase()) as { count: number };
    expect(row.count).toBe(2);
  });

  it("marks account as deployed", () => {
    const addr = "0x1111111111111111111111111111111111111111";
    insertAccount(db, "0xaaaa000000000000000000000000000000000001", addr, 0);

    db.prepare("UPDATE virtual_accounts SET deployed = 1 WHERE address = ?").run(addr.toLowerCase());

    const row = db.prepare("SELECT deployed FROM virtual_accounts WHERE address = ?").get(addr.toLowerCase()) as {
      deployed: number;
    };
    expect(row.deployed).toBe(1);
  });

  it("atomic create respects max limit", () => {
    const master = "0xaabbccddee0011223344556677889900aabbccdd";
    const maxAccounts = 5;

    // Insert 4 accounts
    for (let i = 0; i < 4; i++) {
      insertAccount(db, master, `0x000000000000000000000000000000000000000${i + 1}`, i);
    }

    // Atomic transaction: try to insert 2 more (should fail since 4+2 > 5)
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM virtual_accounts WHERE master = ?");
    const insertStmt = db.prepare(
      "INSERT INTO virtual_accounts (master, address, account_index, deployed, created_at) VALUES (?, ?, ?, 0, ?)"
    );

    const txn = db.transaction((items: { address: string; index: number }[]) => {
      const row = countStmt.get(master.toLowerCase()) as { count: number };
      if (row.count + items.length > maxAccounts) return null;
      for (const item of items) {
        insertStmt.run(master.toLowerCase(), item.address.toLowerCase(), item.index, new Date().toISOString());
      }
      return "ok";
    });

    const result = txn([
      { address: "0x0000000000000000000000000000000000000005", index: 4 },
      { address: "0x0000000000000000000000000000000000000006", index: 5 },
    ]);
    expect(result).toBeNull();

    // Inserting 1 should succeed
    const result2 = txn([{ address: "0x0000000000000000000000000000000000000005", index: 4 }]);
    expect(result2).toBe("ok");
  });
});

describe("sweep_events table", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts and retrieves sweep events", () => {
    insertSweepEvent(db, "0xaccount1000000000000000000000000000000001", "0xmaster10000000000000000000000000000000001", "0xtxhash1", ["POL (native)", "USDC"]);

    const rows = db.prepare("SELECT * FROM sweep_events").all() as any[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].tokens_swept)).toEqual(["POL (native)", "USDC"]);
  });

  it("orders by id descending for recent sweeps", () => {
    insertSweepEvent(db, "0xaccount1000000000000000000000000000000001", "0xmaster10000000000000000000000000000000001", "0xtx1", ["POL (native)"]);
    insertSweepEvent(db, "0xaccount2000000000000000000000000000000002", "0xmaster10000000000000000000000000000000001", "0xtx2", ["USDC"]);
    insertSweepEvent(db, "0xaccount3000000000000000000000000000000003", "0xmaster10000000000000000000000000000000001", "0xtx3", ["WETH"]);

    const rows = db.prepare("SELECT * FROM sweep_events ORDER BY id DESC LIMIT 2").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].tx_hash).toBe("0xtx3");
    expect(rows[1].tx_hash).toBe("0xtx2");
  });
});

describe("getStats aggregation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns zeros when tables are empty", () => {
    const stats = db
      .prepare(
        `SELECT
          COUNT(*) as totalAccounts,
          COUNT(DISTINCT master) as uniqueMasters,
          SUM(CASE WHEN deployed = 1 THEN 1 ELSE 0 END) as deployedAccounts,
          SUM(CASE WHEN deployed = 0 THEN 1 ELSE 0 END) as undeployedAccounts
        FROM virtual_accounts`
      )
      .get() as any;

    expect(stats.totalAccounts).toBe(0);
    expect(stats.uniqueMasters).toBe(0);
  });

  it("aggregates correctly with mixed data", () => {
    const m1 = "0xaaaa000000000000000000000000000000000001";
    const m2 = "0xaaaa000000000000000000000000000000000002";

    insertAccount(db, m1, "0x0000000000000000000000000000000000000001", 0, 1);
    insertAccount(db, m1, "0x0000000000000000000000000000000000000002", 1, 0);
    insertAccount(db, m2, "0x0000000000000000000000000000000000000003", 0, 1);

    insertSweepEvent(db, "0x0000000000000000000000000000000000000001", m1, "0xtx1", ["POL (native)"]);
    insertSweepEvent(db, "0x0000000000000000000000000000000000000003", m2, "0xtx2", ["USDC"]);

    const accountStats = db
      .prepare(
        `SELECT
          COUNT(*) as totalAccounts,
          COUNT(DISTINCT master) as uniqueMasters,
          SUM(CASE WHEN deployed = 1 THEN 1 ELSE 0 END) as deployedAccounts,
          SUM(CASE WHEN deployed = 0 THEN 1 ELSE 0 END) as undeployedAccounts
        FROM virtual_accounts`
      )
      .get() as any;

    const sweepCount = (db.prepare("SELECT COUNT(*) as count FROM sweep_events").get() as any).count;

    expect(accountStats.totalAccounts).toBe(3);
    expect(accountStats.uniqueMasters).toBe(2);
    expect(accountStats.deployedAccounts).toBe(2);
    expect(accountStats.undeployedAccounts).toBe(1);
    expect(sweepCount).toBe(2);
  });

  it("limits recent sweeps to 10", () => {
    const master = "0xaaaa000000000000000000000000000000000001";
    for (let i = 0; i < 15; i++) {
      insertSweepEvent(db, `0xaccount000000000000000000000000000000${String(i).padStart(4, "0")}`, master, `0xtx${i}`, ["TOKEN"]);
    }

    const recent = db.prepare("SELECT * FROM sweep_events ORDER BY id DESC LIMIT 10").all();
    expect(recent).toHaveLength(10);
  });
});
