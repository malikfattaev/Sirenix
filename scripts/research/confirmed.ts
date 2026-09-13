/**
 * Due diligence on one reversion configuration.
 *
 * Reports it per instrument, per month and per side, and gives a t-statistic
 * that treats a whole day as a single bet: equity indices move together, so
 * simultaneous signals are nowhere near independent observations.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/confirmed.ts [threshold stop target hold confirm]
 */
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from '../lib/hourly';
import { UNIVERSE } from '../lib/universe';

const BARS = 5000;
const WARMUP = 120;
const COOLDOWN_HOURS = 6;
const LOOKBACK = 24;
const DAY_MS = 86_400_000;

const THRESHOLD = Number(process.argv[2] ?? 2.0);
const STOP_ATR = Number(process.argv[3] ?? 4);
const TARGET_ATR = Number(process.argv[4] ?? 1.5);
const HOLD_HOURS = Number(process.argv[5] ?? 48);
const CONFIRM = (process.argv[6] ?? 'true') === 'true';
const TYPES = (process.argv[7] ?? 'INDICES').split(',');

interface Trade {
  epic: string;
  type: string;
  direction: 'LONG' | 'SHORT';
  openedAt: number;
  r: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => (values.length ? sum(values) / values.length : 0);

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(sum(values.map((value) => (value - m) ** 2)) / (values.length - 1));
}

function simulate(epic: string, type: string, candles: Candle[]): Trade[] {
  if (candles.length < WARMUP + HOLD_HOURS) return [];
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);

  const trades: Trade[] = [];
  let nextBar = WARMUP;

  for (let i = WARMUP; i < candles.length - HOLD_HOURS; i += 1) {
    if (i < nextBar) continue;
    const a = atr[i];
    const e20 = ema20[i];
    const r = rsi[i];
    if (!a || a <= 0 || e20 === null || r === null) continue;

    const price = closes[i];
    const score = -((price - closes[i - LOOKBACK]) / a + (r - 50) / 20 + (price - e20) / a) / 3;
    if (Math.abs(score) < THRESHOLD) continue;

    const isLong = score > 0;
    if (CONFIRM && (isLong ? price <= candles[i].open : price >= candles[i].open)) continue;

    const side = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = price + (side * spread) / 2;
    const stop = entry - side * STOP_ATR * a;
    const target = entry + side * TARGET_ATR * a;

    const lastIndex = Math.min(candles.length - 1, i + HOLD_HOURS);
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
      epic,
      type,
      direction: isLong ? 'LONG' : 'SHORT',
      openedAt: candles[i].closeTime,
      r: move / (STOP_ATR * a),
    });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }

  return trades;
}

function report(label: string, trades: Trade[]) {
  if (trades.length === 0) {
    console.log(`${label.padEnd(18)} no trades`);
    return;
  }
  const rs = trades.map((trade) => trade.r);
  const wins = trades.filter((trade) => trade.r > 0).length;
  const total = sum(rs);
  console.log(
    `${label.padEnd(18)} n=${String(trades.length).padStart(5)}  ` +
      `win=${((wins / trades.length) * 100).toFixed(1).padStart(5)}%  ` +
      `total=${(total > 0 ? '+' : '') + total.toFixed(1)}R`.padEnd(15) +
      `  per=${(total / trades.length).toFixed(3)}R`,
  );
}

async function main() {
  const entries = UNIVERSE.filter((entry) => TYPES.includes(entry.type));
  console.log(
    `threshold ${THRESHOLD}  stop ${STOP_ATR} ATR  target ${TARGET_ATR} ATR  hold ${HOLD_HOURS}h  ` +
      `confirm ${CONFIRM}  ${TYPES.join('+')}\n`,
  );

  const all: Trade[] = [];
  for (const entry of entries) {
    try {
      const candles = await hourlyCandles(entry.epic, BARS);
      all.push(...simulate(entry.epic, entry.type, candles));
    } catch {
      // Skip anything the broker does not quote.
    }
  }
  if (all.length === 0) {
    console.log('no trades');
    return;
  }
  all.sort((a, b) => a.openedAt - b.openedAt);

  report('OVERALL', all);
  console.log();
  report('LONG', all.filter((trade) => trade.direction === 'LONG'));
  report('SHORT', all.filter((trade) => trade.direction === 'SHORT'));

  console.log('\nBy instrument');
  const epics = [...new Set(all.map((trade) => trade.epic))];
  const perEpic = epics
    .map((epic) => ({ epic, trades: all.filter((trade) => trade.epic === epic) }))
    .sort((a, b) => sum(b.trades.map((t) => t.r)) - sum(a.trades.map((t) => t.r)));
  for (const row of perEpic) report(`  ${row.epic}`, row.trades);
  console.log(
    `  ${perEpic.filter((row) => sum(row.trades.map((t) => t.r)) > 0).length} of ${perEpic.length} positive`,
  );

  console.log('\nBy month');
  const months = [...new Set(all.map((trade) => new Date(trade.openedAt).toISOString().slice(0, 7)))].sort();
  for (const month of months) {
    report(`  ${month}`, all.filter((trade) => new Date(trade.openedAt).toISOString().slice(0, 7) === month));
  }
  const monthlyR = months.map((month) =>
    sum(all.filter((trade) => new Date(trade.openedAt).toISOString().slice(0, 7) === month).map((t) => t.r)),
  );
  console.log(`  ${monthlyR.filter((r) => r > 0).length} of ${months.length} months positive`);

  // One day of simultaneous signals across correlated markets is one bet.
  const days = [...new Set(all.map((trade) => Math.floor(trade.openedAt / DAY_MS)))];
  const daily = days.map((day) => mean(all.filter((t) => Math.floor(t.openedAt / DAY_MS) === day).map((t) => t.r)));
  const deviation = stdev(daily);
  const t = deviation === 0 ? 0 : (mean(daily) / deviation) * Math.sqrt(daily.length);
  console.log(`\nDaily bets ${daily.length}, mean ${mean(daily).toFixed(4)}R, t = ${t.toFixed(2)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
