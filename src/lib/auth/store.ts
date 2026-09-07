import type Database from 'better-sqlite3';
import { connection } from '@/lib/db/connection';
import type { Role } from '@/lib/config';

export interface UserRow {
  id: number;
  login: string;
  password: string;
  role: Role;
  created_at: number;
  last_seen_at: number | null;
}

export interface SessionRow {
  token_hash: string;
  user_id: number;
  created_at: number;
  expires_at: number;
}

let ready = false;

/**
 * The shared handle with the account tables guaranteed to exist.
 *
 * Logins are compared without regard to case, so `Admin` and `admin` cannot be
 * two different people. Sessions are keyed by the hash of the token, never the
 * token itself, and go away with their user.
 */
export function accounts(): Database.Database {
  const instance = connection();
  if (ready) return instance;

  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      login        TEXT    NOT NULL COLLATE NOCASE UNIQUE,
      password     TEXT    NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'user',
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  `);

  ready = true;
  return instance;
}
