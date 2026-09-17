/**
 * Does the confluence score mean anything?
 *
 * The engine grades every setup out of a hundred and refuses anything under
 * `minScore`. That threshold is the cheapest lever in the whole system — one
 * number, and it decides how many trades are taken — but it is only a lever if
 * the score it filters on is related to the outcome. If an 85 does no better
 * than a 65, then raising the bar removes trades at random, and the score is a
 * number the interface shows rather than a measurement.
 *
 * So this buckets every trade by the score it was given and prices each bucket.
 * A working score produces a line that rises. A meaningless one produces a flat
 * line with noise on it, and that is worth knowing precisely because it points
 * at where the work has to happen: not at the threshold, but at what is being
 * scored.
 *
 * Both halves are reported per bucket, because a score that only sorts trades
 * in one half of the sample is sorting them by luck.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/score.ts [days]
 */
import { DEFAULT_TUNING } from '@/lib/config';
import { replay, type BacktestTrade } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';
import { ACTIVE_MARKETS } from '../lib/universe';
import { describe } from '../lib/stats';

const days = Number(process.argv[2] ?? 41);

/** Score bands. The engine's own floor is 62, so the first band is what it takes today. */
const BANDS = [
  { from: 0, to: 65 },
  { from: 65, to: 70 },
  { from: 70, to: 75 },
  { from: 75, to: 80 },
  { from: 80, to: 100 },
];

/**
 * The floor is dropped to zero so the bands below the live one are visible.
 *
 * Without this the sample starts at 62 and the question cannot be asked: a
 * score that sorts well might only sort well across a range that has already
 * been cut away.
 */
const TUNING = { ...DEFAULT_TUNING, minScore: 0 };

interface Row {
  trade: BacktestTrade;
  /** Where in the window this sits, so the sample can be halved by time. */
  position: number;
}

function band(rows: Row[], from: number, to: number): string {
  const here = rows.filter((row) => row.trade.score >= from && row.trade.score < to);
  if (here.length < 20) return `  ${`${from}-${to}`.padEnd(10)} only ${here.length} trades`;

  const sorted = [...here].sort((a, b) => a.position - b.position);
  const values = sorted.map((row) => row.trade.r);
  const whole = describe(values);
  const half = Math.floor(values.length / 2);
  const first = describe(values.slice(0, half));
  const second = describe(values.slice(half));
  const wins = here.filter((row) => row.trade.outcome === 'WIN').length;

  return (
    `  ${`${from}-${to}`.padEnd(10)} ${String(whole.n).padStart(5)} ` +
    `${((wins / here.length) * 100).toFixed(0).padStart(4)}% ` +
    `${whole.mean.toFixed(3).padStart(8)}R ${whole.total.toFixed(1).padStart(8)}R ` +
    `${whole.t.toFixed(2).padStart(6)}  ` +
    `${first.mean.toFixed(3).padStart(7)}R ${second.mean.toFixed(3).padStart(7)}R`
  );
}

async function main() {
  const rows: Row[] = [];

  for (const instrument of ACTIVE_MARKETS) {
    try {
      const data = await loadHistory(instrument, days);
      const result = replay(instrument, data, { days, tuning: TUNING });
      if (result.signals === 0) continue;
      const from = result.from;
      const span = Math.max(1, result.to - from);
      for (const trade of result.trades) {
        rows.push({ trade, position: (trade.openedAt - from) / span });
      }
    } catch (error) {
      console.error(`${instrument.label}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n${days} days, ${rows.length} trades, score floor dropped to zero.\n`);
  console.log(
    `  ${'score'.padEnd(10)} ${'n'.padStart(5)} ${'win'.padStart(5)} ${'exp'.padStart(9)} ` +
      `${'total'.padStart(9)} ${'t'.padStart(6)}  ${'first'.padStart(8)} ${'second'.padStart(8)}`,
  );
  for (const { from, to } of BANDS) console.log(band(rows, from, to));

  // The single number the whole table exists to produce: the correlation
  // between what the engine thought of a setup and what the setup did.
  const scores = rows.map((row) => row.trade.score);
  const results = rows.map((row) => row.trade.r);
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const meanResult = results.reduce((a, b) => a + b, 0) / results.length;
  let covariance = 0;
  let varianceScore = 0;
  let varianceResult = 0;
  for (const [index, score] of scores.entries()) {
    const ds = score - meanScore;
    const dr = results[index] - meanResult;
    covariance += ds * dr;
    varianceScore += ds * ds;
    varianceResult += dr * dr;
  }
  const correlation = covariance / Math.sqrt(varianceScore * varianceResult);
  const t = correlation * Math.sqrt((rows.length - 2) / Math.max(1e-9, 1 - correlation ** 2));

  console.log(
    `\n  score against result: correlation ${correlation.toFixed(4)}, t ${t.toFixed(2)}` +
      (Math.abs(t) > 2 ? '' : '  — indistinguishable from none'),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
