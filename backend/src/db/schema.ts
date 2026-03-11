import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "..", "polsweeper.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
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
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
