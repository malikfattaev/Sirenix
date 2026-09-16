/** The handful of numbers every study in here reports, and the test they have to pass. */
import { median } from '@/lib/indicators';

export { median };

export interface Stat {
  n: number;
  mean: number;
  median: number;
  /** Share of observations above zero. */
  hit: number;
  /** Mean over its own standard error: how much of this is not luck. */
  t: number;
  total: number;
}

export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export function describe(values: number[]): Stat {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, hit: 0, t: 0, total: 0 };
  const m = mean(values);
  const variance = mean(values.map((value) => (value - m) ** 2));
  const stderr = Math.sqrt(variance / values.length);
  return {
    n: values.length,
    mean: m,
    median: median(values),
    hit: values.filter((value) => value > 0).length / values.length,
    t: stderr > 0 ? m / stderr : 0,
    total: values.reduce((a, b) => a + b, 0),
  };
}

export const HEADER =
  `  ${'rule'.padEnd(32)} ${'mean'.padStart(8)} ${'median'.padStart(8)} ${'hit'.padStart(5)} ` +
  `${'t'.padStart(6)} ${'first'.padStart(8)} ${'second'.padStart(8)} ${'n'.padStart(5)}`;

/**
 * One row, and whether it survived.
 *
 * Four conditions, and a finding has to meet all of them: both halves of the
 * sample positive, so it is not one good quarter; a median above zero, so it is
 * not one enormous day carrying a thousand losses; a t above two, so it is not
 * noise; and enough observations to say any of that. Everything this repository
 * has tested so far has failed at least one, usually the first.
 *
 * `values` must already be in time order for the split to mean anything.
 */
export function row(name: string, values: number[], minimum = 30): string {
  if (values.length < minimum) return `  ${name.padEnd(32)} only ${values.length} observations`;

  const whole = describe(values);
  const half = Math.floor(values.length / 2);
  const first = describe(values.slice(0, half));
  const second = describe(values.slice(half));
  const survives = Math.min(first.mean, second.mean) > 0 && whole.median > 0 && whole.t > 2;

  return (
    `  ${name.padEnd(32)} ${whole.mean.toFixed(4).padStart(8)} ${whole.median.toFixed(4).padStart(8)} ` +
    `${(whole.hit * 100).toFixed(0).padStart(4)}% ${whole.t.toFixed(2).padStart(6)} ` +
    `${first.mean.toFixed(4).padStart(8)} ${second.mean.toFixed(4).padStart(8)} ${String(whole.n).padStart(5)}` +
    (survives ? '  <-- SURVIVES' : '')
  );
}
