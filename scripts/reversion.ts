/**
 * Does the mean-reversion effect survive the spread?
 *
 * Pooled research found that recent moves are partly given back, consistently
 * across the universe and both halves of the history. An information
 * coefficient does not pay for anything on its own, so this measures the actual
 * move in the extreme buckets and nets off the spread that trading them costs.
 *
 * Usage: npx tsx --env-file=.env.local scripts/reversion.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FEATURE_NAMES } from './universe';

interface Row {
  epic: string;
  type: string;
  time: number;
  hour: number;
  features: number[];
  forward: number[];
  spreadRatio: number;
}

const HORIZONS = [5, 15, 30, 60];
const rows: Row[] = JSON.parse(
  readFileSync(path.join(process.cwd(), 'data', 'pooled.json'), 'utf8'),
);

const idx = (name: string) => FEATURE_NAMES.indexOf(name as (typeof FEATURE_NAMES)[number]);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/**
 * Fade score: positive means "recent move was down, expect a bounce up".
 * Equal weights on purpose, because fitted weights on 47 correlated markets
 * would just be another way to overfit.
 */
const COMPONENTS = ['return 5m', 'return 15m', 'return 30m', 'rsi 5m', 'extension 5m', 'range position'];
function fadeScore(row: Row): number {
  return -mean(COMPONENTS.map((name) => row.features[idx(name)]));
}

const times = rows.map((row) => row.time).sort((a, b) => a - b);
const cutoff = times[Math.floor(times.length / 2)];
const halves = [rows.filter((r) => r.time < cutoff), rows.filter((r) => r.time >= cutoff)];

console.log(`${rows.length} rows, ${new Set(rows.map((r) => r.epic)).size} instruments`);
console.log(`mean round-trip spread: ${(mean(rows.map((r) => r.spreadRatio)) * 100).toFixed(1)}% of 5m ATR\n`);

console.log('Decile of the fade score vs mean forward move (ATR), by horizon.');
console.log('Decile 0 = strongest recent rally (fade short), 9 = strongest drop (fade long).\n');

for (const [label, part] of [['first half', halves[0]], ['second half', halves[1]]] as const) {
  const sorted = [...part].sort((a, b) => fadeScore(a) - fadeScore(b));
  const size = Math.floor(sorted.length / 10);
  console.log(`--- ${label} ---`);
  console.log(`${'decile'.padEnd(8)}` + HORIZONS.map((h) => `${h}m`.padStart(10)).join(''));
  for (let d = 0; d < 10; d += 1) {
    const bucket = sorted.slice(d * size, (d + 1) * size);
    console.log(
      `${String(d).padEnd(8)}` +
        HORIZONS.map((_, h) => mean(bucket.map((r) => r.forward[h])).toFixed(3).padStart(10)).join(''),
    );
  }
  console.log('');
}

console.log('Net edge of the extreme deciles, after paying the spread, by asset class.');
console.log('Signal = long the bottom decile, short the top decile.\n');
console.log(
  `${'class'.padEnd(18)} ${'n'.padStart(7)} ${'spread'.padStart(8)}` +
    HORIZONS.map((h) => `${h}m net`.padStart(12)).join('') + '   both halves',
);

for (const type of [...new Set(rows.map((row) => row.type))]) {
  const inClass = rows.filter((row) => row.type === type);
  const spread = mean(inClass.map((row) => row.spreadRatio));

  const perHalf = halves.map((part) => {
    const subset = part.filter((row) => row.type === type);
    const sorted = [...subset].sort((a, b) => fadeScore(a) - fadeScore(b));
    const size = Math.floor(sorted.length / 10);
    const shortSide = sorted.slice(0, size);
    const longSide = sorted.slice(-size);
    return HORIZONS.map((_, h) => {
      // Long the oversold decile, short the overbought one, minus the spread.
      const gross = (mean(longSide.map((r) => r.forward[h])) - mean(shortSide.map((r) => r.forward[h]))) / 2;
      return gross - spread;
    });
  });

  const consistent = HORIZONS.map((_, h) => perHalf[0][h] > 0 && perHalf[1][h] > 0);
  console.log(
    `${type.padEnd(18)} ${String(inClass.length).padStart(7)} ${(spread * 100).toFixed(1).padStart(7)}%` +
      HORIZONS.map((_, h) => `${perHalf[0][h].toFixed(3)}/${perHalf[1][h].toFixed(3)}`.padStart(12)).join('') +
      '   ' +
      consistent.map((ok, h) => (ok ? `${HORIZONS[h]}m` : '')).filter(Boolean).join(' '),
  );
}
