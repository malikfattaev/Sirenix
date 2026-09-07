import type Database from 'better-sqlite3';
import {
  ALL_INSTRUMENTS,
  HORIZON_LABEL,
  SIGNAL_LIFETIME_MS,
  type Horizon,
} from '@/lib/config';
import type { Candle } from '@/lib/market/candles';
import { connection } from '@/lib/db/connection';
import type { Quote } from '@/lib/quotes';
import type { Signal } from '@/lib/strategy';

/**
 * How a signal ended.
 *
 * EXPIRED means it ran its full holding time and was settled at the market
 * price, so it carries a result. REVERSED is a legacy of the build that let the
 * engine turn around mid-trade: it means the signal was closed at market when
 * the opposite one was issued. Nothing produces it now, because nothing may
 * turn around mid-trade. Both carry a result in R.
 * CANCELLED is only for a signal that can no longer be judged at all, because
 * its market is no longer quoted here; a signal whose strategy was retired still
 * gets followed to its conclusion.
 */
export type SignalStatus = 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'REVERSED' | 'CANCELLED';

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

let ready = false;

/** The shared handle, with the signal tables guaranteed to exist. */
function db(): Database.Database {
  const instance = connection();
  if (ready) return instance;
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
  ready = true;
  return instance;
}

/** The horizons the app still runs, and so can still judge a signal on. */
const LIVE_HORIZONS = Object.keys(HORIZON_LABEL);

function migrate(connection: Database.Database) {
  const columns = connection.prepare('PRAGMA table_info(signals)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'expires_at')) {
    connection.exec('ALTER TABLE signals ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0');
  }

  // Rows written before the deadline was stored per signal: give each the one
  // its horizon runs under.
  const undated = connection
    .prepare(
      `SELECT id, horizon, created_at FROM signals
        WHERE expires_at = 0 AND horizon IN (${LIVE_HORIZONS.map(() => '?').join(', ')})`,
    )
    .all(...LIVE_HORIZONS) as { id: number; horizon: Horizon; created_at: number }[];
  const setExpiry = connection.prepare('UPDATE signals SET expires_at = ? WHERE id = ?');
  for (const row of undated) {
    setExpiry.run(row.created_at + SIGNAL_LIFETIME_MS[row.horizon], row.id);
  }

  // A signal the app can no longer judge is cancelled rather than left open
  // forever: either its market is off the board, or it was issued on a horizon
  // that has since been retired and whose terms no longer exist here.
  const tracked = ALL_INSTRUMENTS.map((instrument) => instrument.id);
  connection
    .prepare(
      `UPDATE signals SET status = 'CANCELLED', closed_at = ?
        WHERE status = 'OPEN'
          AND (instrument_id NOT IN (${tracked.map(() => '?').join(', ')})
               OR horizon NOT IN (${LIVE_HORIZONS.map(() => '?').join(', ')}))`,
    )
    .run(Date.now(), ...tracked, ...LIVE_HORIZONS);
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
 * Stores a live signal, unless one is already running on that market.
 *
 * A market carries one signal per horizon at a time, the way a position does.
 * While one is open it stands, whichever strategy proposes it and however many
 * polls repeat it; a second entry alongside it would be the same trade counted
 * twice. Nothing opposite can arrive here at all: `withPosition` keeps the board
 * on the open signal until it reaches its stop, its target or its deadline.
 */
export function recordSignal(signal: Signal): SignalRecord | null {
  if (signal.type === 'WAIT' || !signal.plan || !signal.strategy) return null;

  const existing = db()
    .prepare(
      `SELECT * FROM signals
        WHERE instrument_id = ? AND horizon = ? AND direction = ? AND status = 'OPEN'
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(
      signal.instrumentId,
      signal.horizon,
      signal.type,
      signal.updatedAt - SIGNAL_LIFETIME_MS[signal.horizon],
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
 */
export function resolveOpenSignals(
  instrumentId: string,
  horizon: Horizon,
  candles: Candle[],
  now: number,
  quote?: Quote,
): number {
  const open = db()
    .prepare(`SELECT * FROM signals WHERE instrument_id = ? AND horizon = ? AND status = 'OPEN'`)
    .all(instrumentId, horizon) as Row[];
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
      // Candles are mid prices, but a trade lives on one side of the book: a
      // long is stopped out when the *bid* reaches the level, and the bid sits
      // half a spread below the mid. Checking the mid is how a stop that has
      // already been taken keeps reading as untouched.
      const exit = tradedExit(candle, isLong);
      if (isLong ? exit.low <= row.stop_loss : exit.high >= row.stop_loss) {
        outcome = { status: 'LOSS', price: row.stop_loss, at: candle.closeTime };
        break;
      }
      if (isLong ? exit.high >= row.take_profit : exit.low <= row.take_profit) {
        outcome = { status: 'WIN', price: row.take_profit, at: candle.closeTime };
        break;
      }
    }

    // Candles only close once a minute, and the feed publishes them a moment
    // later. The live quote is a second old, so a level taken out right now is
    // settled now rather than a minute after the fact, which is what made the
    // board show a dead trade as still running.
    if (!outcome && quote) {
      const exit = isLong ? quote.bid : quote.ask;
      if (exit !== null && quote.marketStatus === 'TRADEABLE') {
        if (isLong ? exit <= row.stop_loss : exit >= row.stop_loss) {
          outcome = { status: 'LOSS', price: row.stop_loss, at: now };
        } else if (isLong ? exit >= row.take_profit : exit <= row.take_profit) {
          outcome = { status: 'WIN', price: row.take_profit, at: now };
        }
      }
    }

    if (!outcome && now > row.expires_at) {
      const last = since[since.length - 1];
      const price = quote && quote.bid !== null && quote.ask !== null
        ? (isLong ? quote.bid : quote.ask)
        : last
          ? tradedExit(last, isLong).close
          : null;
      if (price !== null) outcome = { status: 'EXPIRED', price, at: now };
    }
    if (!outcome) continue;

    const move = isLong ? outcome.price - row.entry : row.entry - outcome.price;
    update.run(outcome.status, Number((move / risk).toFixed(2)), outcome.at, row.id);
    settled += 1;
  }

  return settled;
}


/** The record, as the dashboard states it. */
export interface SignalStats {
  /** Signals issued, all time. */
  total: number;
  /** Of those, how many ended above water. */
  profitable: number;
  /** How many are running right now. */
  open: number;
}

/**
 * Counts the same slice the history table shows, so the numbers above the list
 * and the rows in it can never disagree. "Profitable" means the signal ended
 * above water, whether it got there by reaching its target or by running out of
 * time in front, which is what the money actually did.
 */
export function signalStats(): SignalStats {
  const rows = recentSignals(ALL_ROWS);

  return {
    total: rows.length,
    profitable: rows.filter((row) => row.resultR !== null && row.resultR > 0).length,
    open: rows.filter((row) => row.status === 'OPEN').length,
  };
}

/**
 * Empties the history.
 *
 * Settled signals only. A signal still running is what holds its market to one
 * direction, so deleting it would free the engine to publish the opposite one
 * against a trade that is still open, which is the failure this whole guard
 * exists to prevent. Those stay, and the count of them is returned so the page
 * can say so.
 */
export function clearHistory(): { removed: number; kept: number } {
  const removed = db().prepare("DELETE FROM signals WHERE status != 'OPEN'").run().changes;
  const kept = (
    db().prepare("SELECT COUNT(*) AS n FROM signals WHERE status = 'OPEN'").get() as { n: number }
  ).n;
  return { removed, kept };
}

/**
 * Closes open signals on markets that have just left the board.
 *
 * Nothing fetches their candles any more, so there is no price to judge them
 * against: they are marked unevaluated rather than left standing as forecasts
 * nobody is going to settle.
 */
export function cancelUntracked(active: string[]): number {
  if (active.length === 0) return 0;
  return db()
    .prepare(
      `UPDATE signals SET status = 'CANCELLED', closed_at = ?
        WHERE status = 'OPEN' AND instrument_id NOT IN (${active.map(() => '?').join(', ')})`,
    )
    .run(Date.now(), ...active).changes;
}

/**
 * The candle as the side of the book a trade actually exits on.
 *
 * A long is closed by selling at the bid, a short by buying back at the ask,
 * and the candle carries the spread that was quoted at its close. Judging an
 * exit on the mid credits the trade with half a spread it never had.
 */
function tradedExit(candle: Candle, isLong: boolean) {
  const half = (isLong ? -1 : 1) * (candle.spread / 2);
  return {
    high: candle.high + half,
    low: candle.low + half,
    close: candle.close + half,
  };
}

/** SQLite reads a negative LIMIT as no limit at all. */
const ALL_ROWS = -1;

/** The signal currently running on a market, if there is one. */
export function openSignal(instrumentId: string, horizon: Horizon): SignalRecord | null {
  const row = db()
    .prepare(
      `SELECT * FROM signals WHERE instrument_id = ? AND horizon = ? AND status = 'OPEN'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(instrumentId, horizon) as Row | undefined;
  return row ? toRecord(row) : null;
}

/** The last signal that ended badly on a market, used to hold off a re-entry. */
export function lastLoss(instrumentId: string, horizon: Horizon): SignalRecord | null {
  const row = db()
    .prepare(
      `SELECT * FROM signals
        WHERE instrument_id = ? AND horizon = ? AND status IN ('LOSS', 'REVERSED')
          AND result_r < 0
        ORDER BY closed_at DESC LIMIT 1`,
    )
    .get(instrumentId, horizon) as Row | undefined;
  return row ? toRecord(row) : null;
}

/**
 * Most recent signals, newest first.
 *
 * Restricted to what the app can still stand behind: the markets on the board,
 * on the horizons it still runs. A signal issued on terms that no longer exist
 * here can never be settled honestly, so it is left out of the record rather
 * than shown as an open forecast nobody is going to judge. Every row stays in
 * the database either way.
 */
export function recentSignals(limit = 25): SignalRecord[] {
  const tracked = ALL_INSTRUMENTS.map((instrument) => instrument.id);
  const rows = db()
    .prepare(
      `SELECT * FROM signals
        WHERE instrument_id IN (${tracked.map(() => '?').join(', ')})
          AND horizon IN (${LIVE_HORIZONS.map(() => '?').join(', ')})
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...tracked, ...LIVE_HORIZONS, limit) as Row[];
  return rows.map(toRecord);
}
