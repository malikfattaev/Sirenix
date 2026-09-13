/**
 * Due diligence on the index mean-reversion result.
 *
 * A profit-factor above one is not enough on its own: the result has to hold up
 * per instrument and month by month, and the trade count has to mean something.
 * Thirteen equity indices move together, so simultaneous signals are close to
 * one bet, not thirteen, and this reports that clustering explicitly.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/validate.ts [bars]
 */
import { capital } from '@/lib/capital/client';
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';
import { UNIVERSE } from '../lib/universe';

const bars = Number(process.argv[2] ?? 5000);
const WARMUP = 220;
const ENTRY_THRESHOLD = 1.4;
const STOP_ATR = 6;
const TARGET_ATR = 6;
const HOLD_HOURS = 24;
const COOLDOWN_HOURS = 12;

interface Trade {
  epic: string;
  direction: 'LONG' | 'SHORT';
  openedAt: number;
  closedAt: number;
  r: number;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function run(epic: string, candles: Candle[]): Trade[] {
  if (candles.length < WARMUP + 100) return [];
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
    if (!a || e20 === null || r === null) continue;

    const price = closes[i];
    const score = -mean([(price - closes[i - 24]) / a, (r - 50) / 20, (price - e20) / a]);
    if (Math.abs(score) < ENTRY_THRESHOLD) continue;

    const isLong = score > 0;
    const s = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = price + (s * spread) / 2;
    const stop = entry - s * STOP_ATR * a;
    const target = entry + s * TARGET_ATR * a;

    let exitIndex = Math.min(candles.length - 1, i + HOLD_HOURS);
    let exitPrice = closes[exitIndex];
    for (let j = i + 1; j <= Math.min(candles.length - 1, i + HOLD_HOURS); j += 1) {
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

    trades.push({
      epic,
      direction: isLong ? 'LONG' : 'SHORT',
      openedAt: candles[i].closeTime,
      closedAt: candles[exitIndex].closeTime,
      r: (s * (exitPrice - entry) - spread / 2) / (3 * a),
    });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }
  return trades;
}

async function main() {
  const indices = UNIVERSE.filter((entry) => entry.type === 'INDICES');
  const all: Trade[] = [];

  for (const instrument of indices) {
    try {
      const candles = toCandles(await capital.getCandles(instrument.epic, 'HOUR', bars), 'HOUR');
      all.push(...run(instrument.epic, candles));
    } catch (error) {
      console.log(`${instrument.epic}: ${(error as Error).message}`);
    }
  }

  console.log(`${all.length} trades across ${new Set(all.map((t) => t.epic)).size} indices\n`);

  console.log('Per instrument:');
  let positive = 0;
  for (const epic of [...new Set(all.map((trade) => trade.epic))].sort()) {
    const subset = all.filter((trade) => trade.epic === epic);
    const total = sum(subset.map((t) => t.r));
    if (total > 0) positive += 1;
    console.log(
      `  ${epic.padEnd(8)} n=${String(subset.length).padStart(4)} ` +
        `win=${((subset.filter((t) => t.r > 0).length / subset.length) * 100).toFixed(1).padStart(5)}% ` +
        `total=${total.toFixed(1).padStart(7)}R`,
    );
  }
  console.log(`  ${positive} of ${new Set(all.map((t) => t.epic)).size} instruments positive\n`);

  console.log('Per month:');
  const months = new Map<string, Trade[]>();
  for (const trade of all) {
    const key = new Date(trade.openedAt).toISOString().slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), trade]);
  }
  let positiveMonths = 0;
  for (const [month, subset] of [...months].sort()) {
    const total = sum(subset.map((t) => t.r));
    if (total > 0) positiveMonths += 1;
    console.log(
      `  ${month}  n=${String(subset.length).padStart(4)} total=${total.toFixed(1).padStart(7)}R ` +
        `${total > 0 ? '+'.repeat(Math.min(Math.round(total / 3), 20)) : '-'.repeat(Math.min(Math.round(-total / 3), 20))}`,
    );
  }
  console.log(`  ${positiveMonths} of ${months.size} months positive\n`);

  // Correlated markets signalling together are close to a single bet.
  const days = new Map<string, Trade[]>();
  for (const trade of all) {
    const key = new Date(trade.openedAt).toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), trade]);
  }
  const perDay = [...days.values()].map((list) => list.length);
  console.log(
    `Clustering: ${days.size} trading days, ${mean(perDay).toFixed(1)} trades per active day, ` +
      `max ${Math.max(...perDay)} at once`,
  );
  const dailyR = [...days.values()].map((list) => sum(list.map((t) => t.r)));
  const dailyMean = mean(dailyR);
  const dailySd = Math.sqrt(mean(dailyR.map((r) => (r - dailyMean) ** 2)));
  console.log(
    `Treating one day as one independent bet: ${days.size} bets, ` +
      `mean ${dailyMean.toFixed(3)}R, t = ${(dailyMean / (dailySd / Math.sqrt(days.size))).toFixed(2)}`,
  );
}

main().catch((error) => { console.error(error); process.exit(1); });
