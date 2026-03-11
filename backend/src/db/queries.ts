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
