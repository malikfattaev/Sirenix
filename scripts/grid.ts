/**
 * Parameter grid for the index mean-reversion signal.
 *
 * The goal is the most signals and the highest win rate that still keep a
 * positive expectancy in *both* halves of the history. A configuration that
 * only works in one half is rejected no matter how good its headline looks.
 *
 * Usage: npx tsx --env-file=.env.local scripts/grid.ts [bars]
 */
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from './hourly';
import { UNIVERSE } from './universe';

const bars = Number(process.argv[2] ?? 5000);
const WARMUP = 220;
const COOLDOWN_HOURS = 6;

interface Config {
  threshold: number;
  stopAtr: number;
  targetAtr: number;
  holdHours: number;
}

interface Trade {
  epic: string;
  openedAt: number;
  r: number;
  win: boolean;
}

/** Precomputed per instrument so the grid only replays the decision. */
interface Prepared {
  epic: string;
  candles: Candle[];
  score: (number | null)[];
  atr: (number | null)[];
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Fade score: positive when the market has fallen and is stretched. */
function prepare(epic: string, candles: Candle[]): Prepared {
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);

  const score = candles.map((_, i) => {
    const a = atr[i];
    const e20 = ema20[i];
    const r = rsi[i];
    if (!a || e20 === null || r === null || i < 24) return null;
    return -mean([(closes[i] - closes[i - 24]) / a, (r - 50) / 20, (closes[i] - e20) / a]);
  });

  return { epic, candles, score, atr };
}

function simulate(prepared: Prepared, config: Config): Trade[] {
  const { candles, score, atr, epic } = prepared;
  const trades: Trade[] = [];
  let nextBar = WARMUP;

  for (let i = WARMUP; i < candles.length - config.holdHours; i += 1) {
    if (i < nextBar) continue;
    const value = score[i];
    const a = atr[i];
    if (value === null || !a) continue;
    if (Math.abs(value) < config.threshold) continue;

    const isLong = value > 0;
    const s = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = candles[i].close + (s * spread) / 2;
    const stop = entry - s * config.stopAtr * a;
    const target = entry + s * config.targetAtr * a;

    let exitIndex = Math.min(candles.length - 1, i + config.holdHours);
    let exitPrice = candles[exitIndex].close;
    for (let j = i + 1; j <= Math.min(candles.length - 1, i + config.holdHours); j += 1) {
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

    const move = s * (exitPrice - entry) - spread / 2;
    // Risk is the real stop distance, so R is comparable across configurations.
    trades.push({ epic, openedAt: candles[i].closeTime, r: move / (config.stopAtr * a), win: move > 0 });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }
  return trades;
}

async function main() {
  const indices = UNIVERSE.filter((entry) => entry.type === 'INDICES');
  const prepared: Prepared[] = [];
  for (const instrument of indices) {
    try {
      const candles = await hourlyCandles(instrument.epic, bars);
      if (candles.length > WARMUP + 200) prepared.push(prepare(instrument.epic, candles));
    } catch (error) {
      console.log(`${instrument.epic}: ${(error as Error).message}`);
    }
  }
  console.log(`${prepared.length} indices loaded\n`);

  const configs: Config[] = [];
  for (const threshold of [0.7, 1.0, 1.3, 1.6]) {
    for (const stopAtr of [5, 6, 8]) {
      for (const targetAtr of [1.5, 2, 3, 4, 6]) {
        for (const holdHours of [24, 48]) {
          configs.push({ threshold, stopAtr, targetAtr, holdHours });
        }
      }
    }
  }

  interface Scored {
    config: Config;
    trades: number;
    winRate: number;
    expectancy: number;
    totalR: number;
    halves: number[];
    tradesPerDay: number;
  }

  const results: Scored[] = [];
  for (const config of configs) {
    const trades = prepared.flatMap((entry) => simulate(entry, config));
    if (trades.length < 200) continue;

    const times = trades.map((trade) => trade.openedAt).sort((a, b) => a - b);
    const cutoff = times[Math.floor(times.length / 2)];
    const halves = [
      sum(trades.filter((t) => t.openedAt < cutoff).map((t) => t.r)),
      sum(trades.filter((t) => t.openedAt >= cutoff).map((t) => t.r)),
    ];
    const days = new Set(trades.map((t) => new Date(t.openedAt).toISOString().slice(0, 10))).size;

    results.push({
      config,
      trades: trades.length,
      winRate: (trades.filter((t) => t.win).length / trades.length) * 100,
      expectancy: mean(trades.map((t) => t.r)),
      totalR: sum(trades.map((t) => t.r)),
      halves,
      tradesPerDay: trades.length / days,
    });
  }

  const robust = results.filter((entry) => entry.halves[0] > 0 && entry.halves[1] > 0);
  console.log(`${results.length} configurations tested, ${robust.length} positive in both halves\n`);
  console.log(
    `${'thr'.padStart(4)} ${'stop'.padStart(5)} ${'tgt'.padStart(4)} ${'hold'.padStart(5)} ` +
      `${'n'.padStart(5)} ${'win%'.padStart(6)} ${'exp'.padStart(7)} ${'total'.padStart(8)} ${'1st/2nd'.padStart(15)} ${'/day'.padStart(5)}`,
  );

  // Highest win rate first, since that is what the signals are judged on.
  for (const entry of robust.sort((a, b) => b.winRate - a.winRate).slice(0, 25)) {
    const { config: c } = entry;
    console.log(
      `${c.threshold.toFixed(1).padStart(4)} ${c.stopAtr.toFixed(0).padStart(5)} ${c.targetAtr.toFixed(1).padStart(4)} ${String(c.holdHours).padStart(5)} ` +
        `${String(entry.trades).padStart(5)} ${entry.winRate.toFixed(1).padStart(6)} ${entry.expectancy.toFixed(3).padStart(7)} ` +
        `${entry.totalR.toFixed(1).padStart(8)} ${`${entry.halves[0].toFixed(0)}/${entry.halves[1].toFixed(0)}`.padStart(15)} ${entry.tradesPerDay.toFixed(1).padStart(5)}`,
    );
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
