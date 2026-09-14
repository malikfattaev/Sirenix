import type Database from 'better-sqlite3';
import { connection } from './connection';
import type { Signal } from '@/lib/strategy/types';
import type { Horizon } from '@/lib/config';

/**
 * How long a rejected snapshot is worth keeping.
 *
 * Nothing reads further back than a day: the summary covers twenty-four hours
 * and the listing takes the newest a hundred rows. A week leaves room to look
 * into something that happened over a weekend, and a limit of some kind is not
 * optional — a snapshot is an entire signal in JSON, and the analysis loop
 * files one a minute per market for as long as the server runs.
 */
const RETENTION_MS = 7 * 86_400_000;

/** Deleting is a scan, so it runs on a clock of its own rather than per insert. */
const PRUNE_INTERVAL_MS = 60 * 60_000;
let prunedAt = 0;

function prune(instance: Database.Database): void {
  const now = Date.now();
  if (now - prunedAt < PRUNE_INTERVAL_MS) return;
  prunedAt = now;
  instance.prepare('DELETE FROM signal_skips WHERE created_at < ?').run(now - RETENTION_MS);
}

let ready = false;
function db() {
  const instance = connection();
  if (!ready) {
    instance.exec(`CREATE TABLE IF NOT EXISTS signal_skips (
      id INTEGER PRIMARY KEY,
      instrument_id TEXT NOT NULL,
      horizon TEXT NOT NULL,
      minute INTEGER NOT NULL,
      code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      UNIQUE(instrument_id, horizon, minute, code)
    );
    CREATE INDEX IF NOT EXISTS idx_skips_recent ON signal_skips(created_at DESC);`);
    ready = true;
  }
  return instance;
}

/** First snapshot per market/horizon/reason/minute, independent of poll frequency. */
export function recordSkip(signal: Signal): void {
  if (signal.type !== 'WAIT') return;
  const codes = [...new Set(signal.rejections?.map((r) => r.code) ?? ['unknown'])];
  const instance = db();
  const insert = instance.prepare(`INSERT OR IGNORE INTO signal_skips
    (instrument_id, horizon, minute, code, created_at, snapshot) VALUES (?, ?, ?, ?, ?, ?)`);
  instance.transaction(() => {
    for (const code of codes) insert.run(signal.instrumentId, signal.horizon,
      Math.floor(signal.updatedAt / 60_000), code, signal.updatedAt, JSON.stringify(signal));
  })();
  prune(instance);
}

export function recentSkips(limit = 50) {
  const rows = db().prepare('SELECT id, code, snapshot FROM signal_skips ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as { id: number; code: string; snapshot: string }[];
  return rows.map(({ snapshot, ...row }) => ({ ...row, signal: JSON.parse(snapshot) as Signal }));
}

export function skipSummary(since: number) {
  return db().prepare(`SELECT instrument_id AS instrumentId, horizon, code, COUNT(*) AS samples
    FROM signal_skips WHERE created_at >= ? GROUP BY instrument_id, horizon, code
    ORDER BY instrument_id, horizon, samples DESC`).all(since) as {
      instrumentId: string; horizon: Horizon; code: string; samples: number;
    }[];
}
