/**
 * What predicts the next one to two hours, after the spread is paid?
 *
 * The horizon is fixed by how the account is traded rather than by what the
 * data would prefer: positions are held for at most two hours, so an effect
 * that only pays over two days is not an effect that can be used here. That is
 * a hard constraint, and it is the whole reason this study exists separately
 * from the pooled one — the same feature can predict a week and say nothing
 * about the next hour.
 *
 * Every number is net of the round trip. A CFD is entered at the ask and left
 * at the bid, so one full spread is paid whatever happens, and a prediction
 * that does not clear it is not a trade. Moves are measured in ATR so that
 * gold, an index and Brent can be pooled without the largest number dominating.
 *
 * Observations are stepped by the horizon rather than taken at every bar: two
 * overlapping two-hour windows share an hour of the same move, and counting
 * both is how a sample of noise starts to look significant.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/shortHorizon.ts [bars]
 */
import { atr as atrSeries, ema, median, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from '../lib/hourly';
import { UNIVERSE } from '../lib/universe';

const bars = Number(process.argv[2] ?? 5000);
const WARMUP = 120;

/** Hours held. The account cannot carry a position longer than this. */
const HORIZONS = [1, 2];

/** A decile: the tenth of the sample where a feature is most extreme. */
const BUCKET = 0.1;

interface Series {
  candles: Candle[];
  ema20: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
  atrBaseline: number;
}

function buildSeries(candles: Candle[]): Series {
  const closes = candles.map((candle) => candle.close);
  const atr = atrSeries(candles, 14);
  return {
    candles,
    ema20: ema(closes, 20),
    rsi: rsiSeries(closes, 14),
    atr,
    atrBaseline: median(atr.filter((value): value is number => value !== null)),
  };
}

/**
 * Candidate predictors, every one of them scale-free.
 *
 * Returns are divided by ATR and indicator distances by ATR as well, so a
 * reading of +2 means the same thing on Brent as it does on the Nasdaq.
 */
const FEATURES = [
  'return 1h',
  'return 2h',
  'return 4h',
  'return 6h',
  'return 24h',
  'rsi - 50',
  'close - ema20',
  'range position 24h',
  'atr ratio',
  'body 1h',
  'wick balance',
  'reversal 6h-1h',
] as const;

function featuresAt(series: Series, i: number): number[] | null {
  const { candles, ema20, rsi, atr, atrBaseline } = series;
  const a = atr[i];
  const e20 = ema20[i];
  const r = rsi[i];
  if (!a || a <= 0 || e20 === null || r === null) return null;

  const c = candles[i];
  const back = (hours: number) => (c.close - candles[i - hours].close) / a;

  const window = candles.slice(i - 23, i + 1);
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  const span = high - low;

  const body = (c.close - c.open) / a;
  const upper = (c.high - Math.max(c.open, c.close)) / a;
  const lower = (Math.min(c.open, c.close) - c.low) / a;

  const values = [
    back(1),
    back(2),
    back(4),
    back(6),
    back(24),
    (r - 50) / 10,
    (c.close - e20) / a,
    span > 0 ? ((c.close - low) / span) * 2 - 1 : 0,
    a / atrBaseline,
    body,
    lower - upper,
    back(6) - back(1),
  ];

  return values.every(Number.isFinite) ? values : null;
}

interface Row {
  epic: string;
  type: string;
  /** Where in the history this sits, 0 to 1, so the sample can be halved. */
  position: number;
  features: number[];
  /** Forward move in ATR, per horizon, before cost. */
  forward: number[];
  /** The round trip, in the same ATR units. */
  cost: number;
  /**
   * What this market did on average over the same horizon, in the same units.
   *
   * Gold went from 3400 to 4300 across this sample. Any rule that happens to
   * buy is paid by that alone, and every long-side "finding" in a sample like
   * this is the trend wearing a feature's name. Subtracting the market's own
   * drift asks the only question that matters: does the signal beat holding?
   */
  drift: number[];
}

async function collect(): Promise<Row[]> {
  const rows: Row[] = [];

  for (const entry of UNIVERSE) {
    let candles: Candle[];
    try {
      candles = await hourlyCandles(entry.epic, bars);
    } catch (error) {
      console.error(`${entry.epic}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    if (candles.length < WARMUP + 48) continue;

    const series = buildSeries(candles);
    const longest = Math.max(...HORIZONS);

    // The market's own average move over each horizon, measured on the same
    // bars the study uses, so the benchmark and the signal see one history.
    const drift = HORIZONS.map((h) => {
      const moves: number[] = [];
      for (let i = WARMUP; i < candles.length - longest; i += longest) {
        const a = series.atr[i];
        if (a && a > 0) moves.push((candles[i + h].close - candles[i].close) / a);
      }
      return moves.length ? moves.reduce((x, y) => x + y, 0) / moves.length : 0;
    });

    // Stepped by the longest horizon so no two observations share a move.
    for (let i = WARMUP; i < candles.length - longest; i += longest) {
      const features = featuresAt(series, i);
      const a = series.atr[i];
      if (!features || !a || a <= 0) continue;

      const forward = HORIZONS.map((h) => (candles[i + h].close - candles[i].close) / a);
      if (!forward.every(Number.isFinite)) continue;

      rows.push({
        epic: entry.epic,
        type: entry.type,
        position: i / candles.length,
        features,
        forward,
        cost: candles[i].spread / a,
        drift,
      });
    }
    process.stdout.write('.');
  }

  process.stdout.write('\n');
  return rows;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/**
 * What a decile of this feature paid, net of the round trip.
 *
 * Both tails are reported because a predictor is only useful if its two ends
 * disagree: a feature whose top and bottom deciles both drift up is measuring
 * the market, not the signal.
 */
function tails(rows: Row[], feature: number, horizon: number) {
  const sorted = [...rows].sort((a, b) => a.features[feature] - b.features[feature]);
  const size = Math.max(1, Math.floor(sorted.length * BUCKET));
  const bottom = sorted.slice(0, size);
  const top = sorted.slice(-size);

  // Excess over holding the same market, net of the round trip. A long is only
  // credited with what it beat the drift by; a short has to overcome the drift
  // as well as the spread, which is what makes an uptrend expensive to fade.
  const netLong = (row: Row) => row.forward[horizon] - row.drift[horizon] - row.cost;
  const netShort = (row: Row) => -(row.forward[horizon] - row.drift[horizon]) - row.cost;

  return {
    size,
    topLong: describe(top.map(netLong)),
    topShort: describe(top.map(netShort)),
    bottomLong: describe(bottom.map(netLong)),
    bottomShort: describe(bottom.map(netShort)),
  };
}

interface Stat {
  mean: number;
  median: number;
  /** Share of observations that ended above water. */
  hit: number;
  /** Mean over its own standard error: below about 2 this is not evidence. */
  t: number;
}

/**
 * Mean, median, hit rate and t.
 *
 * A mean on its own is the easiest number in this whole study to be fooled by:
 * two hundred-odd observations of a market that rallied hard contain a handful
 * of moves large enough to carry the average on their own. When the median is
 * near zero and the hit rate near half, the mean is describing those few moves
 * and nothing else.
 */
function describe(values: number[]): Stat {
  if (values.length === 0) return { mean: 0, median: 0, hit: 0, t: 0 };
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  const stderr = Math.sqrt(variance / values.length);
  return {
    mean: m,
    median: median(values),
    hit: values.filter((v) => v > 0).length / values.length,
    t: stderr > 0 ? m / stderr : 0,
  };
}

/** The same measurement on each half, which is where fitted parameters die. */
function halves(rows: Row[], feature: number, horizon: number) {
  const first = rows.filter((row) => row.position < 0.5);
  const second = rows.filter((row) => row.position >= 0.5);
  return [tails(first, feature, horizon), tails(second, feature, horizon)];
}

/**
 * Every feature and side, best first, whether or not it pays.
 *
 * A table of nothing but survivors hides the thing worth knowing when there are
 * no survivors: how far off the best candidate was. A near miss is a reason to
 * condition the same idea on something else; a rout is a reason to stop.
 */
function report(rows: Row[], horizon: number, hours: number, title: string, limit = 8) {
  console.log(`\n===== ${title} — held ${hours}h, net ATR after the round trip =====`);
  if (rows.length < 400) {
    console.log(`  only ${rows.length} observations, not worth reading`);
    return;
  }

  const lines: { worst: number; line: string }[] = [];
  for (const [index, name] of FEATURES.entries()) {
    const whole = tails(rows, index, horizon);
    const [a, b] = halves(rows, index, horizon);
    const candidates = [
      { side: 'top L', whole: whole.topLong, first: a.topLong, second: b.topLong },
      { side: 'top S', whole: whole.topShort, first: a.topShort, second: b.topShort },
      { side: 'bot L', whole: whole.bottomLong, first: a.bottomLong, second: b.bottomLong },
      { side: 'bot S', whole: whole.bottomShort, first: a.bottomShort, second: b.bottomShort },
    ];
    for (const c of candidates) {
      const worst = Math.min(c.first.mean, c.second.mean);
      // Survives only if both halves pay, the middle observation pays too and
      // the whole-sample mean is more than noise.
      const survives = worst > 0 && c.whole.median > 0 && c.whole.t > 2;
      lines.push({
        worst,
        line:
          `${name.padEnd(20)} ${c.side.padEnd(6)} ${c.whole.mean.toFixed(4).padStart(8)} ` +
          `${c.whole.median.toFixed(4).padStart(8)} ${(c.whole.hit * 100).toFixed(0).padStart(4)}% ` +
          `${c.whole.t.toFixed(2).padStart(6)} ${c.first.mean.toFixed(4).padStart(8)} ` +
          `${c.second.mean.toFixed(4).padStart(8)}  ${whole.size}` +
          (survives ? '  <-- SURVIVES' : ''),
      });
    }
  }

  console.log(
    `  ${'feature'.padEnd(20)} ${'side'.padEnd(6)} ${'mean'.padStart(8)} ${'median'.padStart(8)} ` +
      `${'hit'.padStart(5)} ${'t'.padStart(6)} ${'first'.padStart(8)} ${'second'.padStart(8)}  n`,
  );
  for (const l of lines.sort((x, y) => y.worst - x.worst).slice(0, limit)) console.log(`  ${l.line}`);
}

async function main() {
  console.log(`Loading ${bars} hourly candles for ${UNIVERSE.length} markets...`);
  const rows = await collect();
  console.log(
    `\n${rows.length} non-overlapping observations, cost median ` +
      `${median(rows.map((r) => r.cost)).toFixed(3)} ATR\n`,
  );
  console.log('Every figure below is excess over holding that market, net of the round trip.');
  for (const epic of ['GOLD', 'OIL_BRENT', 'US500']) {
    const row = rows.find((r) => r.epic === epic);
    if (row) console.log(`  ${epic.padEnd(10)} drift per 1h ${row.drift[0].toFixed(4)} ATR, per 2h ${row.drift[1].toFixed(4)} ATR`);
  }

  for (const [horizon, hours] of HORIZONS.entries()) {
    report(rows, horizon, hours, 'everything, pooled');

    // The same question asked of one market at a time: a pooled average can
    // bury an effect that only one instrument has.
    for (const epic of ['GOLD', 'OIL_BRENT']) {
      report(rows.filter((row) => row.epic === epic), horizon, hours, epic, 4);
    }

    // And of the classes, because a spread that is 79% of the move on a
    // currency pair is a different problem from one that is 46% on an index.
    for (const type of ['INDICES', 'COMMODITIES']) {
      report(rows.filter((row) => row.type === type), horizon, hours, type, 4);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
