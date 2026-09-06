import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SIGNAL_LIFETIME_MS } from '@/lib/config';
import type { Candle } from '@/lib/market/candles';
import type { Signal } from '@/lib/strategy';

export type SignalStatus = 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';

export interface SignalRecord {
  id: number;
  instrumentId: string;
  label: string;
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
  closedAt: number | null;
}

/** Rows as stored — snake_case, numbers only, the way SQLite hands them back. */
interface Row {
  id: number;
  instrument_id: string;
  label: string;
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
  closed_at: number | null;
}

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'signals.db');

/** Two signals of the same shape inside this window count as one. */
const DEDUPE_WINDOW_MS = 10 * 60_000;

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
      closed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_signals_recent ON signals (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signals_open ON signals (instrument_id, status);
  `);
  return instance;
}

const toRecord = (row: Row): SignalRecord => ({
  id: row.id,
  instrumentId: row.instrument_id,
  label: row.label,
  direction: row.direction,
  strategy: row.strategy,
  score: row.score,
  regime: row.regime,
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
        WHERE instrument_id = ? AND direction = ? AND strategy = ? AND status = 'OPEN'
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(
      signal.instrumentId,
      signal.type,
      signal.strategy,
      signal.updatedAt - DEDUPE_WINDOW_MS,
    ) as Row | undefined;
  if (existing) return toRecord(existing);

  const { plan } = signal;
  const result = db()
    .prepare(
      `INSERT INTO signals (
         instrument_id, label, direction, strategy, score, regime,
         entry, entry_low, entry_high, stop_loss, take_profit, take_profit_2,
         risk_reward, decimals, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      signal.instrumentId,
      signal.label,
      signal.type,
      signal.strategy,
      signal.score,
      signal.regime,
      plan.entry,
      plan.entryLow,
      plan.entryHigh,
      plan.stopLoss,
      plan.takeProfit,
      plan.takeProfit2,
      plan.riskReward,
      signal.decimals,
      signal.updatedAt,
    );

  return toRecord(
    db().prepare('SELECT * FROM signals WHERE id = ?').get(result.lastInsertRowid) as Row,
  );
}

/**
 * Settles open signals against what price actually did afterwards.
 *
 * Walks the 1-minute candles recorded since each signal was issued; if a candle
 * spans both levels the stop is assumed to have been hit first, which is the
 * pessimistic reading and keeps the history honest.
 */
export function resolveOpenSignals(instrumentId: string, candles: Candle[], now: number): number {
  const open = db()
    .prepare(`SELECT * FROM signals WHERE instrument_id = ? AND status = 'OPEN'`)
    .all(instrumentId) as Row[];
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

    if (!outcome && now - row.created_at > SIGNAL_LIFETIME_MS) {
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

/** Most recent signals, newest first. */
export function recentSignals(limit = 25): SignalRecord[] {
  const rows = db()
    .prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Row[];
  return rows.map(toRecord);
}
