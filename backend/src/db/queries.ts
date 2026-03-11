import { getDb } from "./schema";

export interface VirtualAccount {
  id: number;
  master: string;
  address: string;
  account_index: number;
  deployed: number;
  created_at: string;
}

export function getAccountsByMaster(master: string): VirtualAccount[] {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM virtual_accounts WHERE master = ? ORDER BY account_index ASC"
  );
  return stmt.all(master.toLowerCase()) as VirtualAccount[];
}

export function getAccountByAddress(address: string): VirtualAccount | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM virtual_accounts WHERE address = ?");
  return stmt.get(address.toLowerCase()) as VirtualAccount | undefined;
}

export function getAllAccounts(): VirtualAccount[] {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM virtual_accounts ORDER BY id ASC");
  return stmt.all() as VirtualAccount[];
}

export function getAccountCount(master: string): number {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT COUNT(*) as count FROM virtual_accounts WHERE master = ?"
  );
  const row = stmt.get(master.toLowerCase()) as { count: number };
  return row.count;
}

export function insertAccount(
  master: string,
  address: string,
  accountIndex: number
): VirtualAccount {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO virtual_accounts (master, address, account_index, deployed, created_at) VALUES (?, ?, ?, 0, ?)"
  );
  const result = stmt.run(
    master.toLowerCase(),
    address.toLowerCase(),
    accountIndex,
    now
  );
  return {
    id: result.lastInsertRowid as number,
    master: master.toLowerCase(),
    address: address.toLowerCase(),
    account_index: accountIndex,
    deployed: 0,
    created_at: now,
  };
}

export function markDeployed(address: string): void {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE virtual_accounts SET deployed = 1 WHERE address = ?"
  );
  stmt.run(address.toLowerCase());
}

export function insertAccountsBatch(
  accounts: { master: string; address: string; accountIndex: number }[]
): VirtualAccount[] {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO virtual_accounts (master, address, account_index, deployed, created_at) VALUES (?, ?, ?, 0, ?)"
  );

  const insertMany = db.transaction(
    (items: { master: string; address: string; accountIndex: number }[]) => {
      const results: VirtualAccount[] = [];
      for (const item of items) {
        const result = stmt.run(
          item.master.toLowerCase(),
          item.address.toLowerCase(),
          item.accountIndex,
          now
        );
        results.push({
          id: result.lastInsertRowid as number,
          master: item.master.toLowerCase(),
          address: item.address.toLowerCase(),
          account_index: item.accountIndex,
          deployed: 0,
          created_at: now,
        });
      }
      return results;
    }
  );

  return insertMany(accounts);
}

/** Atomic check + insert: re-checks count inside transaction to prevent TOCTOU race */
// ── Sweep Events ────────────────────────────────────────────────────────

export function insertSweepEvent(
  accountAddress: string,
  master: string,
  txHash: string,
  tokenLabels: string[]
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO sweep_events (account_address, master, tx_hash, tokens_swept, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  stmt.run(
    accountAddress.toLowerCase(),
    master.toLowerCase(),
    txHash,
    JSON.stringify(tokenLabels),
    now
  );
}

export interface SweepEvent {
  id: number;
  account_address: string;
  master: string;
  tx_hash: string;
  tokens_swept: string[];
  created_at: string;
}

export interface Stats {
  totalAccounts: number;
  uniqueMasters: number;
  deployedAccounts: number;
  undeployedAccounts: number;
  totalSweeps: number;
  recentSweeps: SweepEvent[];
}

export function getStats(): Stats {
  const db = getDb();

  const accountStats = db
    .prepare(
      `SELECT
        COUNT(*) as totalAccounts,
        COUNT(DISTINCT master) as uniqueMasters,
        SUM(CASE WHEN deployed = 1 THEN 1 ELSE 0 END) as deployedAccounts,
        SUM(CASE WHEN deployed = 0 THEN 1 ELSE 0 END) as undeployedAccounts
      FROM virtual_accounts`
    )
    .get() as {
    totalAccounts: number;
    uniqueMasters: number;
    deployedAccounts: number;
    undeployedAccounts: number;
  };

  const totalSweeps = (
    db.prepare("SELECT COUNT(*) as count FROM sweep_events").get() as {
      count: number;
    }
  ).count;

  const recentRows = db
    .prepare(
      "SELECT * FROM sweep_events ORDER BY id DESC LIMIT 10"
    )
    .all() as {
    id: number;
    account_address: string;
    master: string;
    tx_hash: string;
    tokens_swept: string;
    created_at: string;
  }[];

  const recentSweeps: SweepEvent[] = recentRows.map((row) => ({
    ...row,
    tokens_swept: JSON.parse(row.tokens_swept) as string[],
  }));

  return {
    ...accountStats,
    totalSweeps,
    recentSweeps,
  };
}

export function atomicCreateAccounts(
  master: string,
  accounts: { master: string; address: string; accountIndex: number }[],
  maxAccounts: number
): VirtualAccount[] | null {
  const db = getDb();
  const now = new Date().toISOString();
  const countStmt = db.prepare(
    "SELECT COUNT(*) as count FROM virtual_accounts WHERE master = ?"
  );
  const insertStmt = db.prepare(
    "INSERT INTO virtual_accounts (master, address, account_index, deployed, created_at) VALUES (?, ?, ?, 0, ?)"
  );

  const txn = db.transaction(
    (items: { master: string; address: string; accountIndex: number }[]) => {
      const row = countStmt.get(master.toLowerCase()) as { count: number };
      if (row.count + items.length > maxAccounts) {
        return null;
      }
      const results: VirtualAccount[] = [];
      for (const item of items) {
        const result = insertStmt.run(
          item.master.toLowerCase(),
          item.address.toLowerCase(),
          item.accountIndex,
          now
        );
        results.push({
          id: result.lastInsertRowid as number,
          master: item.master.toLowerCase(),
          address: item.address.toLowerCase(),
          account_index: item.accountIndex,
          deployed: 0,
          created_at: now,
        });
      }
      return results;
    }
  );

  return txn(accounts);
}
