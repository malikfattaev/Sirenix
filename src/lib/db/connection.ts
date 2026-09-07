import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'signals.db');

let instance: Database.Database | null = null;

/**
 * The one database handle the whole server shares.
 *
 * Signals and accounts live in the same file but own their own schema: each
 * module creates the tables it reads on first use, so nothing has to know about
 * anyone else's columns. Moving this to Postgres for a deployment means
 * replacing this file and the two `ensure` blocks, and nothing above them.
 */
export function connection(): Database.Database {
  if (instance) return instance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  return instance;
}
