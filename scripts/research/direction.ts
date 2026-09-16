/**
 * Does the engine pick the right side at all?
 *
 * Everything measured so far has been measured through the stop and the target,
 * and both of them select. `anatomy.ts` found the trades closed by the clock
 * were worth +0.357R each and it is tempting to read that as the entries
 * pointing the right way — but a trade only reaches the clock by not having hit
 * its stop, and "did not fall" is most of the way to "rose". The bucket is
 * positive by construction, and says nothing about skill.
 *
 * So this takes the barriers away. Every signal the engine issues is followed
 * for a fixed number of minutes and the move is recorded whatever happens in
 * between — through what would have been the stop, through what would have been
 * the target. Nothing is selected on, so what is left is the only honest
 * measure of whether the direction was right: the average forward return of the
 * side the engine chose, in units of the risk it planned, net of the spread.
 *
 * Above zero means there is an entry worth building exits around. At zero it
 * means the geometry cannot be fixed, because there is nothing under it to fix.
 *
 * The shorts are reported apart from the longs. A board of indices in a rising
 * market pays a long for holding and charges a short for it, and a pooled
 * average hides which of the two the engine is actually doing.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/direction.ts [days]
 */
import { DEFAULT_TUNING } from '@/lib/config';
import { replay, type BacktestTrade } from '@/lib/backtest/engine';
import type { Candle } from '@/lib/market/candles';
import { loadHistory } from '../lib/data';
import { ACTIVE_MARKETS } from '../lib/universe';
import { describe } from '../lib/stats';

const days = Number(process.argv[2] ?? 41);

/** Minutes held, ignoring both barriers. */
const HORIZONS = [20, 60, 120];


interface Observation {
  direction: 'LONG' | 'SHORT';
  /** Forward move in units of planned risk, per horizon, net of the round trip. */
  moves: number[];
  /**
   * What this market did on average over the same minutes, in the same units.
   *
   * Averaged over every bar of the window, not over this trade — subtracting a
   * trade's own move from itself leaves the spread and nothing else, which is a
   * mistake this file made once already.
   */
  drift: number[];
}

/** The market's mean forward move per horizon, in price, over the whole window. */
function driftOf(candles: Candle[]): number[] {
  return HORIZONS.map((minutes) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i + minutes < candles.length; i += minutes) {
      sum += candles[i + minutes].close - candles[i].close;
      n += 1;
    }
    return n > 0 ? sum / n : 0;
  });
}

/** Index of the first candle closing at or after `time`. */
function indexAt(candles: Candle[], time: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].closeTime < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function observe(
  trade: BacktestTrade,
  candles: Candle[],
  marketDrift: number[],
): Observation | null {
  const risk = Math.abs(trade.entry - trade.stopLoss);
  if (risk <= 0) return null;

  const start = indexAt(candles, trade.openedAt);
  const side = trade.direction === 'LONG' ? 1 : -1;
  const moves: number[] = [];

  for (const minutes of HORIZONS) {
    const end = start + minutes;
    if (end >= candles.length) return null;
    const move = candles[end].close - candles[start].close;
    // The spread is charged once, as it is everywhere else in this repository.
    moves.push((side * move - candles[start].spread) / risk);
  }

  return {
    direction: trade.direction,
    moves,
    drift: marketDrift.map((value) => value / risk),
  };
}

function row(name: string, values: number[]): string {
  if (values.length < 20) return `  ${name.padEnd(24)} only ${values.length} signals`;
  const stat = describe(values);
  return (
    `  ${name.padEnd(24)} ${String(stat.n).padStart(5)} ${stat.mean.toFixed(4).padStart(9)} ` +
    `${stat.median.toFixed(4).padStart(9)} ${(stat.hit * 100).toFixed(0).padStart(4)}% ` +
    `${stat.t.toFixed(2).padStart(7)}` +
    (stat.t > 2 ? '  <-- real' : '')
  );
}

async function main() {
  const all: Observation[] = [];

  for (const instrument of ACTIVE_MARKETS) {
    try {
      const data = await loadHistory(instrument, days);
      const result = replay(instrument, data, { days, tuning: DEFAULT_TUNING });
      const marketDrift = driftOf(data.candles.entry);
      for (const trade of result.trades) {
        const observation = observe(trade, data.candles.entry, marketDrift);
        if (observation) all.push(observation);
      }
    } catch (error) {
      console.error(`${instrument.label}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n${days} days, ${all.length} signals followed through their barriers.\n`);

  for (const [index, minutes] of HORIZONS.entries()) {
    console.log(`===== held ${minutes} minutes, no stop, no target =====`);
    console.log(
      `  ${'side'.padEnd(24)} ${'n'.padStart(5)} ${'mean R'.padStart(9)} ${'median'.padStart(9)} ` +
        `${'hit'.padStart(5)} ${'t'.padStart(7)}`,
    );

    const longs = all.filter((o) => o.direction === 'LONG');
    const shorts = all.filter((o) => o.direction === 'SHORT');

    console.log(row('every signal', all.map((o) => o.moves[index])));
    console.log(row('longs', longs.map((o) => o.moves[index])));
    console.log(row('shorts', shorts.map((o) => o.moves[index])));

    // The same thing with the market's own move taken out, which is the only
    // version that distinguishes a read from a rising tide.
    console.log(
      row('longs, less the drift', longs.map((o) => o.moves[index] - o.drift[index])),
    );
    console.log(
      row('shorts, less the drift', shorts.map((o) => o.moves[index] + o.drift[index])),
    );
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
