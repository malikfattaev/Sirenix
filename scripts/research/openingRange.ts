/**
 * Opening range breakout, filtered by how busy the market is that morning.
 *
 * Zarattini, Barbon and Aziz (SSRN, February 2024) test a five-minute opening
 * range breakout on US equities from 2016 to 2023 and report that the plain
 * version is weak, while the same rule restricted to the twenty stocks with the
 * highest opening relative volume returns 1637% over the period at a Sharpe of
 * 2.81. Their own reading is that the selection does almost all of the work:
 * the breakout is ordinary, and what makes it pay is only taking it where
 * something is actually happening that day.
 *
 * That is worth testing here for one reason and against one difficulty.
 *
 * The reason: it is a day-trading rule with an intraday hold, which is the only
 * kind this account can use, and the filter it depends on — unusual volume — is
 * the one condition none of the studies in this repository has ever applied.
 *
 * The difficulty: their selection picks twenty names out of seven thousand.
 * Ten markets cannot reproduce that, and any claim that they can is a claim
 * about a filter with almost nothing to filter. So the relative-volume screen
 * is measured both ways here — as a threshold each market passes or fails on
 * its own, and as a daily contest where only the busiest market is traded — and
 * the second is reported with its thin sample in plain sight.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/openingRange.ts [bars]
 */
import type { Candle } from '@/lib/market/candles';
import { cachedCandles } from '../lib/candles';
import { byDate, sessionsByMonth, slotter, type Session } from '../lib/sessions';
import { describe, median } from '../lib/stats';

const bars = Number(process.argv[2] ?? 40000);

/** Five-minute bars: 288 of them in a day. */
const SLOTS_PER_DAY = 288;
const MINUTES_PER_SLOT = 5;

/** Opening ranges to try, in bars. Five minutes is the published one. */
const RANGES = [1, 3, 6];

/** Targets in multiples of the risk. The paper holds for ten or to the close. */
const TARGETS = [1, 2, 3, 10];

/** The account cannot hold longer than this. */
const MAX_HOLD_MINUTES = 120;

/** A slot counts as session while it carries this share of the busiest one. */
const SESSION_VOLUME_SHARE = 0.35;

const MARKETS = [
  'US30', 'US500', 'US100', 'RTY', 'DE40', 'FR40', 'NL25', 'UK100',
  'J225', 'HK50', 'GOLD', 'OIL_BRENT', 'OIL_CRUDE',
];

const slotOf = slotter(SLOTS_PER_DAY);

interface Trade {
  epic: string;
  date: string;
  /** Volume of the opening range over this market's median, the "in play" screen. */
  relativeVolume: number;
  /** The round trip as a fraction of the risk: what the trade owes before it starts. */
  cost: number;
  /** Result in units of risk, net of the round trip. */
  r: number;
}

/**
 * One day's breakout, or nothing.
 *
 * The entry is the edge of the opening range and the stop its other edge, so
 * the risk is the range itself. The spread is charged once, as a round trip,
 * against that risk — which is what makes a narrow opening range expensive: the
 * tighter the range, the larger the spread looms beside it.
 *
 * When a bar touches both levels the stop is taken, because nothing in a candle
 * says which came first and the other assumption flatters the result.
 */
function tradeOf(
  day: { index: number; candle: Candle }[],
  session: Session,
  rangeBars: number,
  targetR: number,
): { r: number; volume: number; cost: number } | null {
  const inSession = day.filter((entry) => {
    const slot = slotOf(entry.candle.closeTime);
    return slot >= session.open && slot <= session.close;
  });
  if (inSession.length < rangeBars + 4) return null;

  const range = inSession.slice(0, rangeBars);
  const rest = inSession.slice(rangeBars, rangeBars + MAX_HOLD_MINUTES / MINUTES_PER_SLOT);
  if (rest.length === 0) return null;

  const high = Math.max(...range.map((entry) => entry.candle.high));
  const low = Math.min(...range.map((entry) => entry.candle.low));
  const risk = high - low;
  if (risk <= 0) return null;

  // The side the opening range itself went: up on a green range, down on a red one.
  const isLong = range[range.length - 1].candle.close >= range[0].candle.open;
  const entry = isLong ? high : low;
  const stop = isLong ? low : high;
  const target = entry + (isLong ? 1 : -1) * targetR * risk;
  const spread = median(range.map((entry) => entry.candle.spread));
  const volume = range.reduce((sum, entry) => sum + entry.candle.volume, 0);

  let triggered = false;
  for (const { candle } of rest) {
    if (!triggered) {
      const breaks = isLong ? candle.high >= entry : candle.low <= entry;
      if (!breaks) continue;
      triggered = true;
    }

    const stopHit = isLong ? candle.low <= stop : candle.high >= stop;
    const targetHit = isLong ? candle.high >= target : candle.low <= target;
    if (stopHit) return { r: -1 - spread / risk, volume, cost: spread / risk };
    if (targetHit) return { r: targetR - spread / risk, volume, cost: spread / risk };
  }

  if (!triggered) return null;

  // Still open when the hold ran out: settled at the last price it could be.
  const last = rest[rest.length - 1].candle.close;
  const move = (isLong ? last - entry : entry - last) / risk;
  return { r: move - spread / risk, volume, cost: spread / risk };
}

function line(name: string, trades: Trade[]): string {
  if (trades.length < 30) return `  ${name.padEnd(34)} only ${trades.length} trades`;
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((trade) => trade.r);
  const whole = describe(values);
  const half = Math.floor(values.length / 2);
  const first = describe(values.slice(0, half));
  const second = describe(values.slice(half));
  const survives = Math.min(first.mean, second.mean) > 0 && whole.t > 2;

  return (
    `  ${name.padEnd(34)} ${whole.mean.toFixed(3).padStart(7)} ${(whole.hit * 100).toFixed(0).padStart(4)}% ` +
    `${whole.t.toFixed(2).padStart(6)} ${whole.total.toFixed(1).padStart(8)}R ` +
    `${first.mean.toFixed(3).padStart(7)} ${second.mean.toFixed(3).padStart(7)} ${String(whole.n).padStart(5)}` +
    (survives ? '  <-- SURVIVES' : '')
  );
}

async function main() {
  console.log(`Loading ${bars} five-minute candles for ${MARKETS.length} markets...\n`);

  const loaded = new Map<string, { days: ReturnType<typeof byDate>; sessions: Map<string, Session> }>();
  for (const epic of MARKETS) {
    try {
      const candles = await cachedCandles(epic, 'MINUTE_5', bars);
      loaded.set(epic, {
        days: byDate(candles),
        sessions: sessionsByMonth(candles, SLOTS_PER_DAY, { share: SESSION_VOLUME_SHARE, minSlots: 12 }),
      });
      process.stdout.write('.');
    } catch (error) {
      console.error(`\n${epic}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log('\n');

  const header =
    `  ${'rule'.padEnd(34)} ${'mean R'.padStart(7)} ${'hit'.padStart(5)} ${'t'.padStart(6)} ` +
    `${'total'.padStart(9)} ${'first'.padStart(7)} ${'second'.padStart(7)} ${'n'.padStart(5)}`;

  for (const rangeBars of RANGES) {
    for (const targetR of TARGETS) {
      const trades: Trade[] = [];

      for (const [epic, { days, sessions }] of loaded) {
        const raw: { date: string; r: number; volume: number; cost: number }[] = [];
        for (const [date, list] of days) {
          const session = sessions.get(date.slice(0, 7));
          if (!session) continue;
          const result = tradeOf(list, session, rangeBars, targetR);
          if (result) raw.push({ date, ...result });
        }
        const typical = median(raw.map((entry) => entry.volume));
        for (const entry of raw) {
          trades.push({
            epic,
            date: entry.date,
            relativeVolume: typical > 0 ? entry.volume / typical : 1,
            cost: entry.cost,
            r: entry.r,
          });
        }
      }

      if (trades.length === 0) continue;
      console.log(`\n===== opening range ${rangeBars * MINUTES_PER_SLOT}m, target ${targetR}R, held at most ${MAX_HOLD_MINUTES}m =====`);
      console.log(header);
      console.log(line('every market, every day', trades));
      console.log(line('opening volume > 1.5x median', trades.filter((trade) => trade.relativeVolume > 1.5)));
      console.log(line('opening volume > 2x median', trades.filter((trade) => trade.relativeVolume > 2)));

      // Every study in this repository has died the same death, and it was never
      // the prediction that failed — it was the spread outrunning it. This rule
      // is the first one whose risk is set by the market rather than by a fixed
      // multiple of ATR, so the round trip is a different fraction of it every
      // day, and that fraction can be chosen. Selecting on it is not a forecast
      // of anything: it is declining to pay a toll larger than the road.
      const cheap = trades.filter((trade) => trade.cost < 0.1);
      const dear = trades.filter((trade) => trade.cost > 0.25);
      console.log(line('round trip under 10% of risk', cheap));
      console.log(line('round trip over 25% of risk', dear));
      console.log(line('cheap and busy', cheap.filter((trade) => trade.relativeVolume > 1.5)));

      // The paper's own shape: one contest a day, and only the winner is traded.
      const byDate = new Map<string, Trade[]>();
      for (const trade of trades) {
        const list = byDate.get(trade.date) ?? [];
        list.push(trade);
        byDate.set(trade.date, list);
      }
      const busiest = [...byDate.values()]
        .map((list) => list.sort((a, b) => b.relativeVolume - a.relativeVolume)[0])
        .filter((trade): trade is Trade => trade !== undefined);
      console.log(line('busiest market of the day only', busiest));
      console.log(`  the round trip averages ${(trades.reduce((sum, t) => sum + t.cost, 0) / trades.length).toFixed(3)} of the risk`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
