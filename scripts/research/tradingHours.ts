/**
 * What the spread costs, hour by hour.
 *
 * Every study in this repository has ended the same way: the prediction was
 * worth about nothing and the spread was worth about a sixth of an ATR, so the
 * trade lost the spread. Each of those studies pooled the whole day together,
 * which quietly assumes the spread is a constant. It is not. A CFD desk widens
 * its quote when its own hedge is thin, and on this board that means the hours
 * when the underlying exchange is shut — most of the night for an index, the
 * Asian hours for Brent.
 *
 * This asks how much that matters, and it asks it without predicting anything.
 * The number reported is the round trip as a fraction of the hour's own ATR:
 * what a trade opened in that hour owes before it has done anything. It needs
 * no forecast to be useful, because it identifies hours in which no forecast
 * could pay — if the toll is half an ATR, an hour's move does not cover it, and
 * a signal generated there is lost at the moment it is issued.
 *
 * The live loop currently analyses around the clock and knows none of this.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/tradingHours.ts [bars]
 */
import { atr as atrSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { cachedCandles } from '../lib/candles';
import { median } from '../lib/stats';

const bars = Number(process.argv[2] ?? 20000);

/** Fifteen-minute candles: four to the hour, 96 to the day. */
const PER_HOUR = 4;

const MARKETS = [
  'US30', 'US500', 'US100', 'RTY', 'DE40', 'FR40', 'NL25', 'UK100',
  'J225', 'HK50', 'GOLD', 'OIL_BRENT', 'OIL_CRUDE',
];

/**
 * What one hour of the day costs on one market.
 *
 * The ATR is measured over the preceding fourteen hours rather than within the
 * hour, so a quiet hour is not flattered by its own quietness: the question is
 * what the spread costs relative to how much this market has been moving, not
 * relative to how little it moved while nobody was trading it.
 */
function costByHour(candles: Candle[]): { cost: number[]; move: number[]; n: number[] } {
  const atr = atrSeries(candles, 14 * PER_HOUR);
  const cost: number[][] = Array.from({ length: 24 }, () => []);
  const move: number[][] = Array.from({ length: 24 }, () => []);

  for (const [index, candle] of candles.entries()) {
    const a = atr[index];
    if (!a || a <= 0) continue;
    const hour = new Date(candle.closeTime).getUTCHours();
    cost[hour].push(candle.spread / a);
    move[hour].push((candle.high - candle.low) / a);
  }

  return {
    cost: cost.map(median),
    move: move.map(median),
    n: cost.map((values) => values.length),
  };
}

function bar(value: number, worst: number): string {
  const width = Math.round((value / worst) * 24);
  return '#'.repeat(Math.max(0, Math.min(24, width)));
}

async function main() {
  console.log(`Loading ${bars} fifteen-minute candles for ${MARKETS.length} markets...\n`);

  const loaded = new Map<string, ReturnType<typeof costByHour>>();
  for (const epic of MARKETS) {
    try {
      loaded.set(epic, costByHour(await cachedCandles(epic, 'MINUTE_15', bars)));
    } catch (error) {
      console.error(`${epic}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log('Round trip as a share of ATR, by UTC hour. Lower is cheaper.\n');
  const header = `  hour  ${[...loaded.keys()].map((epic) => epic.slice(0, 6).padStart(7)).join('')}`;
  console.log(header);

  for (let hour = 0; hour < 24; hour += 1) {
    const cells = [...loaded.values()]
      .map((entry) => (entry.n[hour] > 0 ? entry.cost[hour].toFixed(3) : '-'))
      .map((text) => text.padStart(7))
      .join('');
    console.log(`  ${String(hour).padStart(4)}  ${cells}`);
  }

  console.log('\nPooled across the board — the toll, the hour\'s own range, and the gap between them.\n');
  console.log(`  hour     cost    range   range/cost`);

  const pooled: { hour: number; cost: number; move: number; ratio: number }[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const costs = [...loaded.values()].filter((e) => e.n[hour] > 0).map((e) => e.cost[hour]);
    const moves = [...loaded.values()].filter((e) => e.n[hour] > 0).map((e) => e.move[hour]);
    if (costs.length === 0) continue;
    const cost = median(costs);
    const move = median(moves);
    pooled.push({ hour, cost, move, ratio: cost > 0 ? move / cost : 0 });
  }

  const worst = Math.max(...pooled.map((entry) => entry.cost));
  for (const entry of pooled) {
    console.log(
      `  ${String(entry.hour).padStart(4)}  ${entry.cost.toFixed(3).padStart(7)}` +
        ` ${entry.move.toFixed(3).padStart(8)} ${entry.ratio.toFixed(2).padStart(9)}  ${bar(entry.cost, worst)}`,
    );
  }

  // The hours worth trading are the ones where an ordinary move is large beside
  // the toll. That ranking is not a forecast and cannot be overfitted to one:
  // it says only where a forecast would have room to pay for itself.
  const ranked = [...pooled].sort((a, b) => b.ratio - a.ratio);
  const best = ranked.slice(0, 8).map((entry) => entry.hour).sort((a, b) => a - b);
  const cheapest = median(ranked.slice(0, 8).map((entry) => entry.cost));
  const dearest = median(ranked.slice(-8).map((entry) => entry.cost));

  console.log(`\n  best eight hours, UTC: ${best.join(', ')}`);
  console.log(`  toll in those hours: ${cheapest.toFixed(3)} ATR`);
  console.log(`  toll in the worst eight: ${dearest.toFixed(3)} ATR`);
  console.log(`  trading only the good hours saves ${(dearest - cheapest).toFixed(3)} ATR a trade`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
