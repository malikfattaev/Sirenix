/**
 * Eight indices move together. Does the one that breaks ranks come back?
 *
 * Every entry tested in this repository has read one chart at a time — a
 * pullback, a breakout, a stretch from a moving average — and every one has
 * come out at zero before costs. `score.ts` closed that line of enquiry: the
 * engine's own confluence grade correlates -0.031 with what the trade goes on
 * to do, so it is not that the patterns are weighted wrongly, it is that there
 * is nothing in a single chart at this horizon to weigh.
 *
 * This asks a question a single chart cannot answer. The board is eight equity
 * indices, and they are driven by much the same thing: when the US opens green
 * the DAX rarely opens red. That shared move is most of each index's variance,
 * and it is noise for this purpose — what is left after taking it out is the
 * part where one market has moved and its peers have not, and that residual is
 * a far smaller, far less noisy quantity than the index return itself. A signal
 * that must clear a fixed spread does better the less noise it carries.
 *
 * So for every moment each market's recent return is compared with the board's,
 * and the one that has broken ranks hardest is traded against its own move.
 * Nothing here is a forecast of the market; it is a bet that eight things which
 * normally move together will go on doing so.
 *
 * Measured against the same bar as everything else: net of one full round trip,
 * in ATR so the markets pool, on non-overlapping observations, and positive on
 * both halves of the sample or it does not count.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/dislocation.ts [bars]
 */
import { atr as atrSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { cachedCandles } from '../lib/candles';
import { describe, mean } from '../lib/stats';

const bars = Number(process.argv[2] ?? 40000);

/** Five-minute candles: twelve to the hour. */
const PER_HOUR = 12;

/** How far back the move is measured, in bars. */
const LOOKBACKS = [3, 6, 12, 24];

/** How long the position is held afterwards, in bars. Two hours is the ceiling. */
const HOLDS = [3, 6, 12, 24];

/** The eight indices on the board, which is the whole point: they are one family. */
const BOARD = ['US30', 'US500', 'US100', 'DE40', 'J225', 'FR40', 'UK100', 'NL25'];

/** A moment is only usable if this many of the board are quoting into it. */
const MIN_QUOTING = 5;

interface Bar {
  close: number;
  atr: number;
  spread: number;
  volume: number;
}

/** Every market's bars, keyed by close time, so the board can be read a moment at a time. */
type Board = Map<string, Map<number, Bar>>;

async function load(): Promise<Board> {
  const board: Board = new Map();
  for (const epic of BOARD) {
    try {
      const candles = await cachedCandles(epic, 'MINUTE_5', bars);
      const atr = atrSeries(candles, 14 * PER_HOUR);
      const byTime = new Map<number, Bar>();
      for (const [index, candle] of candles.entries()) {
        const a = atr[index];
        if (!a || a <= 0) continue;
        byTime.set(candle.closeTime, {
          close: candle.close,
          atr: a,
          spread: candle.spread,
          volume: candle.volume,
        });
      }
      board.set(epic, byTime);
      process.stdout.write('.');
    } catch (error) {
      console.error(`\n${epic}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log('\n');
  return board;
}

interface Observation {
  /** The residual that triggered it, in ATR: how far out of line this market was. */
  gap: number;
  /** What the market did next, signed so that positive means the gap widened. */
  forward: number;
  /** The round trip, in the same ATR units. */
  cost: number;
  time: number;
}

/** Trade against the gap: sell what ran ahead, buy what was left behind. */
const fade = (o: Observation) => -o.forward - o.cost;

/** Trade with it instead. A different trade, and it pays its own spread. */
const follow = (o: Observation) => o.forward - o.cost;

/**
 * One sweep of the board at one lookback and hold.
 *
 * The move is measured in ATR so a Nasdaq point and a Nikkei point mean the
 * same thing, and the board's median move is subtracted rather than its mean:
 * one index gapping on its own open would otherwise drag the benchmark towards
 * itself and hide exactly the dislocation being looked for.
 */
function sweep(board: Board, lookback: number, hold: number): Observation[] {
  const step = 5 * 60_000;
  const times = [...(board.get(BOARD[0]) ?? new Map()).keys()].sort((a, b) => a - b);
  const observations: Observation[] = [];

  // Stepped by the hold so no two observations share a forward move.
  for (let index = lookback; index + hold < times.length; index += hold) {
    const now = times[index];
    const past = now - lookback * step;
    const future = now + hold * step;

    const quoting: { epic: string; move: number; bar: Bar }[] = [];
    for (const [epic, series] of board) {
      const here = series.get(now);
      const before = series.get(past);
      const after = series.get(future);
      if (!here || !before || !after) continue;
      // Volume of zero means the market is quoted but nobody is trading it.
      if (here.volume <= 0) continue;
      quoting.push({ epic, move: (here.close - before.close) / here.atr, bar: here });
    }
    if (quoting.length < MIN_QUOTING) continue;

    const moves = quoting.map((entry) => entry.move).sort((a, b) => a - b);
    const middle = moves.length >> 1;
    const benchmark = moves.length % 2 ? moves[middle] : (moves[middle - 1] + moves[middle]) / 2;

    // The market furthest from the board, whichever way it went.
    let worst = quoting[0];
    let gap = quoting[0].move - benchmark;
    for (const entry of quoting) {
      const here = entry.move - benchmark;
      if (Math.abs(here) > Math.abs(gap)) {
        worst = entry;
        gap = here;
      }
    }

    const series = board.get(worst.epic)!;
    const after = series.get(future)!;
    const move = (after.close - worst.bar.close) / worst.bar.atr;

    observations.push({
      gap: Math.abs(gap),
      // Signed so that a positive number means the market carried on away from
      // the board: the same quantity answers both trades, and neither is given
      // the spread for free.
      forward: Math.sign(gap) * move,
      cost: worst.bar.spread / worst.bar.atr,
      time: now,
    });
  }

  return observations;
}

function line(
  name: string,
  observations: Observation[],
  rule: (o: Observation) => number = fade,
): string {
  if (observations.length < 40) return `  ${name.padEnd(22)} only ${observations.length} observations`;
  const sorted = [...observations].sort((a, b) => a.time - b.time);
  const values = sorted.map(rule);
  const whole = describe(values);
  const half = Math.floor(values.length / 2);
  const first = describe(values.slice(0, half));
  const second = describe(values.slice(half));
  const survives = Math.min(first.mean, second.mean) > 0 && whole.median > 0 && whole.t > 2;

  return (
    `  ${name.padEnd(22)} ${String(whole.n).padStart(5)} ${whole.mean.toFixed(4).padStart(9)} ` +
    `${whole.median.toFixed(4).padStart(9)} ${(whole.hit * 100).toFixed(0).padStart(4)}% ` +
    `${whole.t.toFixed(2).padStart(6)} ${first.mean.toFixed(4).padStart(9)} ${second.mean.toFixed(4).padStart(9)}` +
    (survives ? '  <-- SURVIVES' : '')
  );
}

async function main() {
  console.log(`Loading ${bars} five-minute candles for ${BOARD.length} indices...`);
  const board = await load();
  if (board.size < MIN_QUOTING) {
    console.error('not enough markets loaded');
    return;
  }

  const header =
    `  ${'rule'.padEnd(22)} ${'n'.padStart(5)} ${'mean R'.padStart(9)} ${'median'.padStart(9)} ` +
    `${'hit'.padStart(5)} ${'t'.padStart(6)} ${'first'.padStart(9)} ${'second'.padStart(9)}`;

  for (const lookback of LOOKBACKS) {
    for (const hold of HOLDS) {
      const observations = sweep(board, lookback, hold);
      if (observations.length < 40) continue;

      console.log(
        `\n===== broke ranks over ${lookback * 5}m, held ${hold * 5}m =====` +
          `  round trip ${mean(observations.map((o) => o.cost)).toFixed(4)} ATR`,
      );
      console.log(header);
      console.log(line('fade it', observations));
      console.log(line('follow it', observations, follow));
      console.log(line('follow, before costs', observations, (o) => o.forward));

      // The bigger the dislocation the more there is to come back from, and the
      // more of it is left after the spread. If the effect is real it should be
      // strongest in the tail; if it is noise the tail is just the loudest noise.
      const sorted = [...observations].sort((a, b) => b.gap - a.gap);
      console.log(line('follow, widest half', sorted.slice(0, Math.floor(sorted.length / 2)), follow));
      console.log(line('follow, widest tenth', sorted.slice(0, Math.floor(sorted.length / 10)), follow));
      console.log(line('fade, widest tenth', sorted.slice(0, Math.floor(sorted.length / 10))));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
