/**
 * At what holding period does an edge finally clear the spread?
 *
 * The predictive effect found in the five-minute study is real but small, while
 * the spread is a fixed cost. Moves grow with the holding period and the spread
 * does not, so this measures the same kind of signal on hourly candles across
 * horizons from four hours to a week, and reports the edge net of cost.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/horizon.ts [bars]
 */
import { capital } from '@/lib/capital/client';
import { atr as atrSeries, ema, median, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';
import { UNIVERSE } from '../lib/universe';

const bars = Number(process.argv[2] ?? 5000);
/** Forward horizons in hours. */
const HORIZONS = [4, 12, 24, 72, 120];
const WARMUP = 220;

const FEATURES = ['return 4h', 'return 24h', 'return 120h', 'rsi 1H', 'extension', 'trend 20/50'] as const;

interface Row {
  type: string;
  time: number;
  features: number[];
  forward: number[];
  spreadRatio: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

async function collect(): Promise<Row[]> {
  const rows: Row[] = [];

  for (const instrument of UNIVERSE) {
    try {
      const candles: Candle[] = toCandles(await capital.getCandles(instrument.epic, 'HOUR', bars), 'HOUR');
      if (candles.length < WARMUP + Math.max(...HORIZONS) + 50) continue;

      const closes = candles.map((candle) => candle.close);
      const ema20 = ema(closes, 20);
      const ema50 = ema(closes, 50);
      const rsi = rsiSeries(closes, 14);
      const atr = atrSeries(candles, 14);
      const atrBase = median(atr.filter((v): v is number => v !== null));

      const horizonMax = Math.max(...HORIZONS);
      for (let i = WARMUP; i < candles.length - horizonMax; i += 1) {
        const a = atr[i];
        const e20 = ema20[i];
        const e50 = ema50[i];
        const r = rsi[i];
        if (!a || e20 === null || e50 === null || r === null) continue;

        const price = closes[i];
        const back = (n: number) => (i >= n ? (price - closes[i - n]) / a : 0);

        rows.push({
          type: instrument.type,
          time: candles[i].closeTime,
          features: [back(4), back(24), back(120), (r - 50) / 20, (price - e20) / a, (e20 - e50) / a].map(
            (v) => clamp(Number.isFinite(v) ? v : 0, -12, 12),
          ),
          forward: HORIZONS.map((h) => (closes[i + h] - price) / a),
          spreadRatio: candles[i].spread / a,
        });
      }
      console.log(`  ${instrument.epic.padEnd(12)} ok  (${candles.length} bars, ${atrBase.toFixed(5)} median ATR)`);
    } catch (error) {
      console.log(`  ${instrument.epic.padEnd(12)} failed: ${(error as Error).message}`);
    }
  }
  return rows;
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 100) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

collect().then((rows) => {
  const times = rows.map((row) => row.time).sort((a, b) => a - b);
  const cutoff = times[Math.floor(times.length / 2)];
  const halves = [rows.filter((r) => r.time < cutoff), rows.filter((r) => r.time >= cutoff)];

  console.log(`\n${rows.length} rows, split at ${new Date(cutoff).toISOString().slice(0, 10)}`);
  console.log(`mean spread ${(mean(rows.map((r) => r.spreadRatio)) * 100).toFixed(1)}% of one 1H ATR\n`);
  console.log(
    `${'feature'.padEnd(14)}` + HORIZONS.map((h) => `${h}h`.padStart(16)).join('') + '   consistent',
  );

  for (let f = 0; f < FEATURES.length; f += 1) {
    const perHorizon = HORIZONS.map((_, h) =>
      halves.map((part) =>
        correlation(part.map((row) => row.features[f]), part.map((row) => row.forward[h])),
      ),
    );
    const hits = perHorizon
      .map((ics, h) => ({ h, ics }))
      .filter(({ ics }) => Math.sign(ics[0]) === Math.sign(ics[1]) && Math.min(...ics.map(Math.abs)) >= 0.015);
    console.log(
      `${FEATURES[f].padEnd(14)}` +
        perHorizon.map(([a, b]) => `${a.toFixed(3)}/${b.toFixed(3)}`.padStart(16)).join('') +
        `   ${hits.map(({ h, ics }) => `${HORIZONS[h]}h${ics[0] > 0 ? '+' : '-'}`).join(' ')}`,
    );
  }

  console.log('\nExtreme-decile edge net of spread, per asset class and horizon.');
  console.log(`${'class'.padEnd(18)} ${'spread'.padStart(7)}` + HORIZONS.map((h) => `${h}h`.padStart(15)).join(''));

  for (const type of [...new Set(rows.map((row) => row.type))]) {
    const inClass = rows.filter((row) => row.type === type);
    const spread = mean(inClass.map((row) => row.spreadRatio));
    // Fade recent strength: the effect the five-minute study identified.
    const score = (row: Row) => -mean([row.features[0], row.features[1], row.features[3], row.features[4]]);

    const perHalf = halves.map((part) => {
      const sorted = [...part].filter((row) => row.type === type).sort((a, b) => score(a) - score(b));
      const size = Math.floor(sorted.length / 10);
      if (size < 20) return HORIZONS.map(() => 0);
      return HORIZONS.map((_, h) => {
        const gross =
          (mean(sorted.slice(-size).map((r) => r.forward[h])) - mean(sorted.slice(0, size).map((r) => r.forward[h]))) / 2;
        return gross - spread;
      });
    });

    console.log(
      `${type.padEnd(18)} ${(spread * 100).toFixed(1).padStart(6)}%` +
        HORIZONS.map((_, h) => `${perHalf[0][h].toFixed(2)}/${perHalf[1][h].toFixed(2)}`.padStart(15)).join(''),
    );
  }
}).catch((error) => { console.error(error); process.exit(1); });
