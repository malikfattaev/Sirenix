/**
 * Does one market predict the next two hours *relative to the others*?
 *
 * Every time-series test on this data has run into the same wall: the feature
 * that looks predictive is the market's own trend wearing a disguise, and once
 * the drift is subtracted the mean survives only on a handful of large moves
 * while the median sits at zero and the hit rate at one half.
 *
 * A cross-sectional test cannot be fooled that way. At each hour the markets
 * are ranked against each other, the extremes at one end are bought and the
 * extremes at the other sold, and whatever moves all of them together — the
 * dollar, the risk mood, the drift — cancels between the two legs. What is left
 * is the only thing the ranking claims to know: which of them is about to do
 * better than the rest.
 *
 * Both legs pay the spread, so the cost here is double, and it is charged.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/crossSection.ts [bars]
 */
import { atr as atrSeries, median } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from '../lib/hourly';
import { UNIVERSE } from '../lib/universe';

const bars = Number(process.argv[2] ?? 5000);
const WARMUP = 48;

/**
 * Hours held, swept rather than fixed.
 *
 * Two is the constraint the account works under, but the cost of a round trip
 * does not change with the hold while the move grows roughly with its square
 * root, so the same signal is worth measuring at every length. Where the line
 * crosses zero is the shortest hold this signal can be traded on at all, and
 * that is a number worth knowing even when it lands out of reach.
 */
const HOLDS = [1, 2, 4, 6, 8, 12, 24, 48];

/** How far back the ranking looks, in hours. */
const LOOKBACKS = [1, 2, 4, 6, 12, 24];

/** Markets taken from each end of the ranking. */
const LEGS = 2;

/**
 * The board this would actually run on: ten markets, gold and Brent among them
 * because the account trades them either way, and the rest the cheapest and
 * most continuously quoted indices, which carry the smallest spread relative to
 * the move they make.
 */
const BOARD = [
  'GOLD', 'OIL_BRENT', 'US30', 'US500', 'US100', 'DE40', 'UK100', 'FR40', 'J225', 'HK50',
];

interface Market {
  epic: string;
  candles: Candle[];
  atr: (number | null)[];
  /** closeTime -> index, so the same wall-clock hour lines up across markets. */
  at: Map<number, number>;
}

async function load(epics: string[]): Promise<Market[]> {
  const markets: Market[] = [];
  for (const epic of epics) {
    try {
      const candles = await hourlyCandles(epic, bars);
      if (candles.length < WARMUP + 48) continue;
      markets.push({
        epic,
        candles,
        atr: atrSeries(candles, 14),
        at: new Map(candles.map((candle, index) => [candle.closeTime, index])),
      });
    } catch (error) {
      console.error(`${epic}: ${error instanceof Error ? error.message : error}`);
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return markets;
}

interface Leg {
  epic: string;
  rank: number;
  /** Forward move over the hold, in ATR. */
  forward: number;
  /** The round trip on this leg, in ATR. */
  cost: number;
}

/** Every hour at which enough markets are quoting to rank them. */
function timeline(markets: Market[]): number[] {
  const counts = new Map<number, number>();
  for (const market of markets) {
    for (const candle of market.candles) {
      counts.set(candle.closeTime, (counts.get(candle.closeTime) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= LEGS * 2 + 2)
    .map(([time]) => time)
    .sort((a, b) => a - b);
}

function legsAt(markets: Market[], time: number, lookback: number, hold: number): Leg[] | null {
  const ranked: Leg[] = [];

  for (const market of markets) {
    const i = market.at.get(time);
    if (i === undefined || i < WARMUP || i + hold >= market.candles.length) continue;
    const a = market.atr[i];
    if (!a || a <= 0) continue;

    const back = market.candles[i - lookback];
    const forwardBar = market.candles[i + hold];
    if (!back || !forwardBar) continue;

    const rank = (market.candles[i].close - back.close) / a;
    const forward = (forwardBar.close - market.candles[i].close) / a;
    if (!Number.isFinite(rank) || !Number.isFinite(forward)) continue;

    ranked.push({ epic: market.epic, rank, forward, cost: market.candles[i].spread / a });
  }

  return ranked.length >= LEGS * 2 + 2 ? ranked.sort((x, y) => x.rank - y.rank) : null;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

interface Stat {
  n: number;
  mean: number;
  median: number;
  hit: number;
  t: number;
}

function describe(values: number[]): Stat {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, hit: 0, t: 0 };
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  const stderr = Math.sqrt(variance / values.length);
  return {
    n: values.length,
    mean: m,
    median: median(values),
    hit: values.filter((v) => v > 0).length / values.length,
    t: stderr > 0 ? m / stderr : 0,
  };
}

const row = (name: string, whole: Stat, first: Stat, second: Stat) =>
  `  ${name.padEnd(26)} ${whole.mean.toFixed(4).padStart(8)} ${whole.median.toFixed(4).padStart(8)} ` +
  `${(whole.hit * 100).toFixed(0).padStart(4)}% ${whole.t.toFixed(2).padStart(6)} ` +
  `${first.mean.toFixed(4).padStart(8)} ${second.mean.toFixed(4).padStart(8)} ${String(whole.n).padStart(6)}` +
  (Math.min(first.mean, second.mean) > 0 && whole.median > 0 && whole.t > 2 ? '  <-- SURVIVES' : '');

function study(markets: Market[], title: string) {
  const times = timeline(markets);
  console.log(`\n===== ${title}: ${markets.length} markets, ${times.length} hours =====`);
  console.log(
    `  ${'rule'.padEnd(26)} ${'mean'.padStart(8)} ${'median'.padStart(8)} ${'hit'.padStart(5)} ` +
      `${'t'.padStart(6)} ${'first'.padStart(8)} ${'second'.padStart(8)} ${'n'.padStart(6)}`,
  );

  for (const lookback of LOOKBACKS) {
   for (const hold of HOLDS) {
    // Stepped by the hold so no two baskets share a move.
    const reversal: number[] = [];
    const momentum: number[] = [];
    const positions: number[] = [];
    const signals: number[] = [];
    const costs: number[] = [];

    for (let index = 0; index < times.length; index += hold) {
      const legs = legsAt(markets, times[index], lookback, hold);
      if (!legs) continue;

      const weakest = legs.slice(0, LEGS);
      const strongest = legs.slice(-LEGS);
      // Buying the laggards and selling the leaders, and the other way round.
      // Both legs pay their own spread, so the cost appears twice.
      // The spread the basket pays either way round: both legs, both sides.
      const cost = mean(weakest.map((leg) => leg.cost)) + mean(strongest.map((leg) => leg.cost));
      const spread = mean(weakest.map((leg) => leg.forward)) - mean(strongest.map((leg) => leg.forward));

      reversal.push(spread - cost);
      momentum.push(-spread - cost);
      signals.push(spread);
      costs.push(cost);
      positions.push(index / times.length);
    }
    if (reversal.length < 100) continue;

    const half = (values: number[], from: number, to: number) =>
      describe(values.filter((_, i) => positions[i] >= from && positions[i] < to));

    // Whichever way the ranking points, reported with the raw signal and the
    // cost beside it so the gap between them is readable at a glance.
    const raw = mean(signals);
    const best = raw >= 0 ? reversal : momentum;
    const name = `${raw >= 0 ? 'fade' : 'follow'} ${lookback}h, hold ${hold}h`;
    console.log(
      row(name, describe(best), half(best, 0, 0.5), half(best, 0.5, 1)) +
        `   signal ${Math.abs(raw).toFixed(4)} vs cost ${mean(costs).toFixed(4)}`,
    );
   }
  }
}

async function main() {
  console.log(`Loading ${bars} hourly candles...`);
  const board = await load(BOARD);
  study(board, 'the ten-market board');

  const everything = await load(UNIVERSE.map((entry) => entry.epic).filter((epic) => !BOARD.includes(epic)));
  study([...board, ...everything], 'the whole universe');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
