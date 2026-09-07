/**
 * Pooled feature research across the whole universe.
 *
 * One instrument cannot tell a weak edge from noise: 21 days of gold is a few
 * hundred independent moves. Pooling dozens of markets multiplies the sample,
 * and an effect that is real shows the same sign in both halves of the history
 * across all of them at once.
 *
 * Indicator series are computed once per instrument and indexed into, rather
 * than recomputed at every bar, which is what makes a universe this size cheap.
 *
 * Usage: npx tsx --env-file=.env.local scripts/pooled.ts [bars]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { capital } from '@/lib/capital/client';
import { atr as atrSeries, ema, median, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';
import { FEATURE_NAMES, HORIZON_BARS, UNIVERSE } from './universe';

const bars = Number(process.argv[2] ?? 5000);
const HORIZONS = HORIZON_BARS;
const WARMUP = 220;

interface Series {
  candles: Candle[];
  ema9: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
  atrBaseline: number;
}

function buildSeries(candles: Candle[]): Series {
  const closes = candles.map((candle) => candle.close);
  const atr = atrSeries(candles, 14);
  return {
    candles,
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    rsi: rsiSeries(closes, 14),
    atr,
    atrBaseline: median(atr.filter((value): value is number => value !== null)),
  };
}

/** Index of the last candle that had closed at `time`. */
function indexAt(candles: Candle[], time: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (candles[mid].closeTime <= time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}


interface Row {
  epic: string;
  type: string;
  time: number;
  hour: number;
  features: number[];
  forward: number[];
  spreadRatio: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const safe = (v: number) => (Number.isFinite(v) ? v : 0);

function featuresAt(m5: Series, m15: Series, h1: Series, i: number): number[] | null {
  const now = m5.candles[i].closeTime;
  const j = indexAt(m15.candles, now);
  const k = indexAt(h1.candles, now);
  if (j < 50 || k < 50) return null;

  const atr = m5.atr[i];
  const a15 = m15.atr[j];
  const a1h = h1.atr[k];
  if (!atr || !a15 || !a1h) return null;

  const c = m5.candles[i];
  const price = c.close;
  const e9 = m5.ema9[i];
  const e20 = m5.ema20[i];
  const e50 = m5.ema50[i];
  const r5 = m5.rsi[i];
  if (e9 === null || e20 === null || e50 === null || r5 === null) return null;

  const back = (n: number) => (i >= n ? (price - m5.candles[i - n].close) / atr : 0);

  const windowBars = m5.candles.slice(Math.max(0, i - 23), i + 1);
  const high = Math.max(...windowBars.map((bar) => bar.high));
  const low = Math.min(...windowBars.map((bar) => bar.low));

  const volumes = m5.candles.slice(Math.max(0, i - 29), i).map((bar) => bar.volume);
  const volumeBase = volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1);
  const range = c.high - c.low;

  return [
    (e9 - e20) / atr,
    (e20 - e50) / atr,
    (m15.ema9[j]! - m15.ema20[j]!) / a15,
    (h1.ema9[k]! - h1.ema20[k]!) / a1h,
    (price - e20) / atr,
    (m15.candles[j].close - m15.ema20[j]!) / a15,
    (r5 - 50) / 20,
    (m15.rsi[j]! - 50) / 20,
    (h1.rsi[k]! - 50) / 20,
    back(1),
    back(3),
    back(6),
    back(12),
    back(48),
    atr / (m5.atrBaseline || atr) - 1,
    high === low ? 0 : ((price - low) / (high - low)) * 2 - 1,
    volumeBase > 0 ? c.volume / volumeBase - 1 : 0,
    (c.close - c.open) / atr,
    range <= 0 ? 0 : (Math.min(c.open, c.close) - c.low - (c.high - Math.max(c.open, c.close))) / range,
    -back(12),
  ].map((value) => clamp(safe(value), -8, 8));
}

async function collect(): Promise<Row[]> {
  const rows: Row[] = [];

  for (const instrument of UNIVERSE) {
    try {
      const [raw5, raw15, raw1h] = await Promise.all([
        capital.getCandles(instrument.epic, 'MINUTE_5', bars),
        capital.getCandles(instrument.epic, 'MINUTE_15', Math.ceil(bars / 3)),
        capital.getCandles(instrument.epic, 'HOUR', Math.ceil(bars / 12)),
      ]);
      const m5 = buildSeries(toCandles(raw5, 'MINUTE_5'));
      const m15 = buildSeries(toCandles(raw15, 'MINUTE_15'));
      const h1 = buildSeries(toCandles(raw1h, 'HOUR'));
      if (m5.candles.length < WARMUP + 100) {
        console.log(`  ${instrument.epic}: skipped, only ${m5.candles.length} bars`);
        continue;
      }

      const horizonMax = Math.max(...HORIZONS);
      let added = 0;
      for (let i = WARMUP; i < m5.candles.length - horizonMax; i += 1) {
        const features = featuresAt(m5, m15, h1, i);
        if (!features) continue;
        const atr = m5.atr[i]!;
        const price = m5.candles[i].close;
        rows.push({
          epic: instrument.epic,
          type: instrument.type,
          time: m5.candles[i].closeTime,
          hour: new Date(m5.candles[i].closeTime).getUTCHours(),
          features,
          forward: HORIZONS.map((h) => (m5.candles[i + h].close - price) / atr),
          spreadRatio: m5.candles[i].spread / atr,
        });
        added += 1;
      }
      console.log(`  ${instrument.epic.padEnd(12)} ${String(added).padStart(5)} rows`);
    } catch (error) {
      console.log(`  ${instrument.epic.padEnd(12)} failed: ${(error as Error).message}`);
    }
  }

  return rows;
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 100) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
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

function main() {
  return collect().then((rows) => {
    if (rows.length === 0) {
      console.log('no data collected');
      return;
    }
    const outFile = path.join(process.cwd(), 'data', 'pooled.json');
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(rows));

    // Split by calendar time, so both halves contain every instrument.
    const times = rows.map((row) => row.time).sort((a, b) => a - b);
    const cutoff = times[Math.floor(times.length / 2)];
    const halves = [rows.filter((r) => r.time < cutoff), rows.filter((r) => r.time >= cutoff)];

    console.log(
      `\n${rows.length} rows from ${new Set(rows.map((r) => r.epic)).size} instruments, ` +
        `split at ${new Date(cutoff).toISOString().slice(0, 16)}`,
    );
    console.log(`halves: ${halves[0].length} / ${halves[1].length} rows\n`);
    console.log(
      `${'feature'.padEnd(16)}` + HORIZONS.map((h) => `${h * 5}m`.padStart(16)).join('') + '   consistent',
    );

    for (let f = 0; f < FEATURE_NAMES.length; f += 1) {
      const perHorizon = HORIZONS.map((_, h) =>
        halves.map((part) =>
          correlation(part.map((row) => row.features[f]), part.map((row) => row.forward[h])),
        ),
      );
      const hits = perHorizon
        .map((ics, h) => ({ h, ics }))
        .filter(({ ics }) => Math.sign(ics[0]) === Math.sign(ics[1]) && Math.min(...ics.map(Math.abs)) >= 0.01);
      console.log(
        `${FEATURE_NAMES[f].padEnd(16)}` +
          perHorizon.map(([a, b]) => `${a.toFixed(3)}/${b.toFixed(3)}`.padStart(16)).join('') +
          `   ${hits.map(({ h, ics }) => `${HORIZONS[h] * 5}m${ics[0] > 0 ? '+' : '-'}`).join(' ')}`,
      );
    }
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
