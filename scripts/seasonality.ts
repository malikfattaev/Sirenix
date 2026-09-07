/**
 * Intraday seasonality: does the hour of day itself carry a direction?
 *
 * Uses hourly candles so the sample spans months rather than weeks, and treats
 * one hour on one day as one observation, because overlapping intraday windows
 * would otherwise inflate the sample size and make noise look significant.
 * Usage: npx tsx --env-file=.env.local scripts/seasonality.ts <hours>
 */
import { capital } from '@/lib/capital/client';
import { INSTRUMENTS } from '@/lib/config';
import { toCandles, type Candle } from '@/lib/market/candles';

const bars = Number(process.argv[2] ?? 6000);

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

/** Student t for "is this mean different from zero", on independent samples. */
const tStat = (values: number[]) =>
  values.length < 2 || stdev(values) === 0 ? 0 : mean(values) / (stdev(values) / Math.sqrt(values.length));

async function main() {
  for (const instrument of INSTRUMENTS) {
    const raw = await capital.getCandles(instrument.epic, 'HOUR', bars);
    const candles: Candle[] = toCandles(raw, 'HOUR');

    // One observation per candle: the return of that hour, in percent.
    const byHour = new Map<number, { returns: number[]; times: number[] }>();
    for (const candle of candles) {
      if (candle.open <= 0) continue;
      const hour = new Date(candle.time).getUTCHours();
      const entry = byHour.get(hour) ?? { returns: [], times: [] };
      entry.returns.push(((candle.close - candle.open) / candle.open) * 100);
      entry.times.push(candle.time);
      byHour.set(hour, entry);
    }

    const span = candles.length
      ? `${new Date(candles[0].time).toISOString().slice(0, 10)} to ${new Date(candles.at(-1)!.time).toISOString().slice(0, 10)}`
      : 'no data';
    const all = [...byHour.values()].flatMap((entry) => entry.returns);
    console.log(`\n================ ${instrument.label} ================`);
    console.log(`${candles.length} hourly candles, ${span}`);
    console.log(`overall drift ${mean(all).toFixed(4)}% per hour\n`);
    console.log(
      `${'hour'.padEnd(6)} ${'n'.padStart(4)} ${'mean %'.padStart(9)} ${'vs drift'.padStart(9)} ${'up %'.padStart(7)} ${'t'.padStart(7)}  ${'1st half'.padStart(9)} ${'2nd half'.padStart(9)}  verdict`,
    );

    const drift = mean(all);
    for (let hour = 0; hour < 24; hour += 1) {
      const entry = byHour.get(hour);
      if (!entry || entry.returns.length < 30) continue;

      const { returns } = entry;
      const half = Math.floor(returns.length / 2);
      const halves = [returns.slice(0, half), returns.slice(half)];
      const halfMeans = halves.map(mean);
      const upRate = (returns.filter((r) => r > 0).length / returns.length) * 100;
      const t = tStat(returns.map((r) => r - drift));

      // Meaningful only if both halves agree and the effect clears noise.
      const agree = Math.sign(halfMeans[0] - drift) === Math.sign(halfMeans[1] - drift);
      const verdict = agree && Math.abs(t) > 2 ? (halfMeans[0] > drift ? 'UP' : 'DOWN') : agree && Math.abs(t) > 1.5 ? 'weak' : '';

      console.log(
        `${(String(hour).padStart(2, '0') + ':00').padEnd(6)} ${String(returns.length).padStart(4)} ` +
          `${mean(returns).toFixed(4).padStart(9)} ${(mean(returns) - drift).toFixed(4).padStart(9)} ${upRate.toFixed(1).padStart(7)} ${t.toFixed(2).padStart(7)}  ` +
          `${halfMeans[0].toFixed(4).padStart(9)} ${halfMeans[1].toFixed(4).padStart(9)}  ${verdict}`,
      );
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
