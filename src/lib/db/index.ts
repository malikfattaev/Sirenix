import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  ALL_INSTRUMENTS,
  DEDUPE_WINDOW_MS,
  HORIZON_LABEL,
  SIGNAL_LIFETIME_MS,
  type Horizon,
} from '@/lib/config';
import type { Candle } from '@/lib/market/candles';
import type { Signal } from '@/lib/strategy';

/**
 * How a signal ended.
 *
 * EXPIRED means it ran its full holding time and was settled at the market
 * price, so it carries a result. CANCELLED is only for a signal that can no
 * longer be judged at all, because its market is no longer quoted here; a
 * signal whose strategy was retired still gets followed to its conclusion.
 */
export type SignalStatus = 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'CANCELLED';

export interface SignalRecord {
  id: number;
  instrumentId: string;
  label: string;
  horizon: Horizon;
  direction: 'LONG' | 'SHORT';
  strategy: string;
  score: number;
  regime: string;
  entry: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  riskReward: number;
  decimals: number;
  status: SignalStatus;
  /** Realised result in units of risk, once the signal has resolved. */
  resultR: number | null;
  createdAt: number;
  /** When the signal is settled at market if neither level is reached. */
  expiresAt: number;
  closedAt: number | null;
}

/** Rows as stored — snake_case, numbers only, the way SQLite hands them back. */
interface Row {
  id: number;
  instrument_id: string;
  label: string;
  horizon: Horizon;
  direction: 'LONG' | 'SHORT';
  strategy: string;
  score: number;
  regime: string;
  entry: number;
  entry_low: number;
  entry_high: number;
  stop_loss: number;
  take_profit: number;
  take_profit_2: number | null;
  risk_reward: number;
  decimals: number;
  status: SignalStatus;
  result_r: number | null;
  created_at: number;
  expires_at: number;
  closed_at: number | null;
}

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'signals.db');

let instance: Database.Database | null = null;

function db(): Database.Database {
  if (instance) return instance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id  TEXT    NOT NULL,
      label          TEXT    NOT NULL,
      direction      TEXT    NOT NULL,
      strategy       TEXT    NOT NULL,
      score          INTEGER NOT NULL,
      regime         TEXT    NOT NULL,
      horizon        TEXT    NOT NULL DEFAULT 'scalp',
      entry          REAL    NOT NULL,
      entry_low      REAL    NOT NULL,
      entry_high     REAL    NOT NULL,
      stop_loss      REAL    NOT NULL,
      take_profit    REAL    NOT NULL,
      take_profit_2  REAL,
      risk_reward    REAL    NOT NULL,
      decimals       INTEGER NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'OPEN',
      result_r       REAL,
      created_at     INTEGER NOT NULL,
      expires_at     INTEGER NOT NULL DEFAULT 0,
      closed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_signals_recent ON signals (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signals_open ON signals (instrument_id, horizon, status);
  `);

  migrate(instance);
  return instance;
}

/**
 * Deadlines used to repair rows written before they were stored per signal.
 * A retired strategy gets the longest of them, so its signals are followed for
 * at least as long as they were ever meant to run rather than cut short.
 */
const RETIRED_LIFETIME_MS = 48 * 60 * 60_000;

function migrate(connection: Database.Database) {
  const columns = connection.prepare('PRAGMA table_info(signals)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'expires_at')) {
    connection.exec('ALTER TABLE signals ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0');
  }

  // Rows written before the deadline was stored: give each the one its horizon
  // ran under, and a retired horizon the longest, so none is cut short.
  const lifetime = (horizon: string) =>
    horizon in SIGNAL_LIFETIME_MS ? SIGNAL_LIFETIME_MS[horizon as Horizon] : RETIRED_LIFETIME_MS;
  const undated = connection
    .prepare('SELECT id, horizon, created_at FROM signals WHERE expires_at = 0')
    .all() as { id: number; horizon: string; created_at: number }[];
  const setExpiry = connection.prepare('UPDATE signals SET expires_at = ? WHERE id = ?');
  for (const row of undated) setExpiry.run(row.created_at + lifetime(row.horizon), row.id);

  // A signal whose market is no longer on the board can never be judged, so it
  // is cancelled. One whose *strategy* was retired still has a live price feed
  // and keeps running to its stop, its target or its deadline.
  const tracked = ALL_INSTRUMENTS.map((instrument) => instrument.id);
  const placeholders = tracked.map(() => '?').join(', ');
  connection
    .prepare(
      `UPDATE signals SET status = 'CANCELLED', closed_at = ?
        WHERE status = 'OPEN' AND instrument_id NOT IN (${placeholders})`,
    )
    .run(Date.now(), ...tracked);

  // Earlier builds closed rows as EXPIRED or CANCELLED the moment a strategy
  // was removed, which claimed an outcome that never happened. Reopen the ones
  // still inside their deadline on a market that is still quoted.
  connection
    .prepare(
      `UPDATE signals SET status = 'OPEN', closed_at = NULL
        WHERE status IN ('EXPIRED', 'CANCELLED') AND result_r IS NULL
          AND expires_at > ? AND instrument_id IN (${placeholders})`,
    )
    .run(Date.now(), ...tracked);
}

const toRecord = (row: Row): SignalRecord => ({
  id: row.id,
  instrumentId: row.instrument_id,
  label: row.label,
  direction: row.direction,
  strategy: row.strategy,
  score: row.score,
  regime: row.regime,
  horizon: row.horizon,
  entry: row.entry,
  entryLow: row.entry_low,
  entryHigh: row.entry_high,
  stopLoss: row.stop_loss,
  takeProfit: row.take_profit,
  takeProfit2: row.take_profit_2,
  riskReward: row.risk_reward,
  decimals: row.decimals,
  status: row.status,
  resultR: row.result_r,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  closedAt: row.closed_at,
});

/**
 * Stores a live signal, unless an equivalent one is already on the board.
 * Repeating the same setup every poll would drown the history in duplicates,
 * so a matching open signal from the last few minutes suppresses the insert.
 */
export function recordSignal(signal: Signal): SignalRecord | null {
  if (signal.type === 'WAIT' || !signal.plan || !signal.strategy) return null;

  const existing = db()
    .prepare(
      `SELECT * FROM signals
        WHERE instrument_id = ? AND horizon = ? AND direction = ? AND strategy = ? AND status = 'OPEN'
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(
      signal.instrumentId,
      signal.horizon,
      signal.type,
      signal.strategy,
      signal.updatedAt - DEDUPE_WINDOW_MS[signal.horizon],
    ) as Row | undefined;
  if (existing) return toRecord(existing);

  const { plan } = signal;
  const result = db()
    .prepare(
      `INSERT INTO signals (
         instrument_id, label, direction, strategy, score, regime, horizon,
         entry, entry_low, entry_high, stop_loss, take_profit, take_profit_2,
         risk_reward, decimals, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      signal.instrumentId,
      signal.label,
      signal.type,
      signal.strategy,
      signal.score,
      signal.regime,
      signal.horizon,
      plan.entry,
      plan.entryLow,
      plan.entryHigh,
      plan.stopLoss,
      plan.takeProfit,
      plan.takeProfit2,
      plan.riskReward,
      signal.decimals,
      signal.updatedAt,
      signal.updatedAt + SIGNAL_LIFETIME_MS[signal.horizon],
    );

  return toRecord(
    db().prepare('SELECT * FROM signals WHERE id = ?').get(result.lastInsertRowid) as Row,
  );
}

/**
 * Settles open signals against what price actually did afterwards.
 *
 * Walks the candles recorded since each signal was issued; if one spans both
 * levels the stop is assumed to have been hit first, which is the pessimistic
 * reading and keeps the history honest.
 *
 * Scoped to one horizon because each market carries two signals at once, and
 * each has to be settled on its own candles: a 15-minute bar is too coarse to
 * judge a scalp, and the minute feed is not what the hour-scale trade lives on.
 *
 * `includeRetired` sweeps in signals from horizons the app no longer runs. They
 * still have a live price feed, so they are followed to their stop, their
 * target or their own recorded deadline rather than abandoned half-answered.
 */
export function resolveOpenSignals(
  instrumentId: string,
  horizon: Horizon,
  candles: Candle[],
  now: number,
  includeRetired = false,
): number {
  const live = Object.keys(HORIZON_LABEL);
  const open = db()
    .prepare(
      includeRetired
        ? `SELECT * FROM signals WHERE instrument_id = ? AND status = 'OPEN'
             AND (horizon = ? OR horizon NOT IN (${live.map(() => '?').join(', ')}))`
        : `SELECT * FROM signals WHERE instrument_id = ? AND horizon = ? AND status = 'OPEN'`,
    )
    .all(...(includeRetired ? [instrumentId, horizon, ...live] : [instrumentId, horizon])) as Row[];
  if (open.length === 0) return 0;

  const update = db().prepare(
    'UPDATE signals SET status = ?, result_r = ?, closed_at = ? WHERE id = ?',
  );
  let settled = 0;

  for (const row of open) {
    const isLong = row.direction === 'LONG';
    const risk = Math.abs(row.entry - row.stop_loss);
    if (risk <= 0) continue;

    const since = candles.filter((candle) => candle.time >= row.created_at);
    let outcome: { status: SignalStatus; price: number; at: number } | null = null;

    for (const candle of since) {
      const stopHit = isLong ? candle.low <= row.stop_loss : candle.high >= row.stop_loss;
      const targetHit = isLong ? candle.high >= row.take_profit : candle.low <= row.take_profit;
      if (stopHit) {
        outcome = { status: 'LOSS', price: row.stop_loss, at: candle.closeTime };
        break;
      }
      if (targetHit) {
        outcome = { status: 'WIN', price: row.take_profit, at: candle.closeTime };
        break;
      }
    }

    if (!outcome && now > row.expires_at) {
      const last = since[since.length - 1];
      if (last) outcome = { status: 'EXPIRED', price: last.close, at: now };
    }
    if (!outcome) continue;

    const move = isLong ? outcome.price - row.entry : row.entry - outcome.price;
    update.run(outcome.status, Number((move / risk).toFixed(2)), outcome.at, row.id);
    settled += 1;
  }

  return settled;
}

/**
 * Most recent signals, newest first.
 *
 * Restricted to the instruments currently on the board: rows left behind by a
 * market that is no longer tracked can never be settled, so they would sit in
 * the history as permanently open. They stay in the database either way.
 */
export function recentSignals(limit = 25): SignalRecord[] {
  const tracked = ALL_INSTRUMENTS.map((instrument) => instrument.id);
  const rows = db()
    .prepare(
      `SELECT * FROM signals WHERE instrument_id IN (${tracked.map(() => '?').join(', ')})
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...tracked, limit) as Row[];
  return rows.map(toRecord);
}
