import { capital } from '@/lib/capital/client';
import { INDEX_INSTRUMENTS, SWING } from '@/lib/config';
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';

/** Bars of history needed before the first signal can be evaluated. */
const WARMUP = 120;
/** Hours to stand aside after a position closes, so one move is traded once. */
const COOLDOWN_HOURS = 6;

export interface SwingTrade {
  instrumentId: string;
  direction: 'LONG' | 'SHORT';
  openedAt: number;
  r: number;
  win: boolean;
}

export interface SwingInstrumentStats {
  instrumentId: string;
  label: string;
  signals: number;
  winRate: number;
  totalR: number;
}

export interface SwingBacktestResult {
  from: number;
  to: number;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancy: number;
  totalR: number;
  profitFactor: number | null;
  /** Result in each half of the window; a strategy has to hold up in both. */
  firstHalfR: number;
  secondHalfR: number;
  byInstrument: SwingInstrumentStats[];
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Replays the daily reversion signal over hourly candles.
 *
 * The stop is checked before the target within each bar: when one candle spans
 * both, only the pessimistic reading is honest, and fills pay the spread that
 * was actually quoted at the time.
 */
function simulate(instrumentId: string, candles: Candle[]): SwingTrade[] {
  if (candles.length < WARMUP + SWING.holdHours) return [];

  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);

  const trades: SwingTrade[] = [];
  let nextBar = WARMUP;

  for (let i = WARMUP; i < candles.length - SWING.holdHours; i += 1) {
    if (i < nextBar) continue;
    const a = atr[i];
    const e20 = ema20[i];
    const r = rsi[i];
    if (!a || a <= 0 || e20 === null || r === null) continue;

    const price = closes[i];
    const past = closes[i - SWING.lookbackHours];
    const score = -((price - past) / a + (r - 50) / 20 + (price - e20) / a) / 3;
    if (Math.abs(score) < SWING.scoreThreshold) continue;

    const isLong = score > 0;
    const side = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = price + (side * spread) / 2;
    const stop = entry - side * SWING.stopAtr * a;
    const target = entry + side * SWING.targetAtr * a;

    const lastIndex = Math.min(candles.length - 1, i + SWING.holdHours);
    let exitIndex = lastIndex;
    let exitPrice = closes[lastIndex];
    for (let j = i + 1; j <= lastIndex; j += 1) {
      if (isLong ? candles[j].low <= stop : candles[j].high >= stop) {
        exitIndex = j;
        exitPrice = stop;
        break;
      }
      if (isLong ? candles[j].high >= target : candles[j].low <= target) {
        exitIndex = j;
        exitPrice = target;
        break;
      }
    }

    const move = side * (exitPrice - entry) - spread / 2;
    trades.push({
      instrumentId,
      direction: isLong ? 'LONG' : 'SHORT',
      openedAt: candles[i].closeTime,
      r: move / (SWING.stopAtr * a),
      win: move > 0,
    });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }

  return trades;
}

/** Runs the daily reversion signal over the whole index universe. */
export async function runSwingBacktest(days: number): Promise<SwingBacktestResult> {
  const bars = Math.min(5000, Math.max(SWING.candleDepth, Math.ceil(days * 24)));
  const all: SwingTrade[] = [];
  const byInstrument: SwingInstrumentStats[] = [];
  let from = Number.POSITIVE_INFINITY;
  let to = 0;

  for (const instrument of INDEX_INSTRUMENTS) {
    const candles = toCandles(await capital.getCandles(instrument.epic, 'HOUR', bars), 'HOUR');
    if (candles.length === 0) continue;
    from = Math.min(from, candles[0].time);
    to = Math.max(to, candles[candles.length - 1].closeTime);

    const trades = simulate(instrument.id, candles);
    all.push(...trades);
    if (trades.length > 0) {
      byInstrument.push({
        instrumentId: instrument.id,
        label: instrument.label,
        signals: trades.length,
        winRate: Number(((trades.filter((t) => t.win).length / trades.length) * 100).toFixed(1)),
        totalR: Number(sum(trades.map((t) => t.r)).toFixed(2)),
      });
    }
  }

  const wins = all.filter((trade) => trade.win);
  const grossProfit = sum(all.filter((t) => t.r > 0).map((t) => t.r));
  const grossLoss = sum(all.filter((t) => t.r <= 0).map((t) => -t.r));
  const times = all.map((trade) => trade.openedAt).sort((a, b) => a - b);
  const cutoff = times[Math.floor(times.length / 2)] ?? 0;

  return {
    from: Number.isFinite(from) ? from : 0,
    to,
    signals: all.length,
    wins: wins.length,
    losses: all.length - wins.length,
    winRate: all.length === 0 ? 0 : Number(((wins.length / all.length) * 100).toFixed(1)),
    expectancy: Number(mean(all.map((t) => t.r)).toFixed(3)),
    totalR: Number(sum(all.map((t) => t.r)).toFixed(2)),
    profitFactor: grossLoss === 0 ? null : Number((grossProfit / grossLoss).toFixed(2)),
    firstHalfR: Number(sum(all.filter((t) => t.openedAt < cutoff).map((t) => t.r)).toFixed(2)),
    secondHalfR: Number(sum(all.filter((t) => t.openedAt >= cutoff).map((t) => t.r)).toFixed(2)),
    byInstrument: byInstrument.sort((a, b) => b.totalR - a.totalR),
  };
}
