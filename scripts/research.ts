/**
 * Feature research: measures what actually predicts the next move.
 *
 * Instead of assuming a setup works, every candidate condition is scored by its
 * information coefficient (the correlation between the feature now and the move
 * afterwards) on two independent halves of the history. A feature only counts
 * if it points the same way on both, which is what separates an edge from a
 * pattern that happened to fit one stretch of market.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research.ts <days>
 */
import { CANDLE_DEPTH, INSTRUMENTS, type TimeframeRole } from '@/lib/config';
import { rangeOf, sessionVwap } from '@/lib/indicators';
import { closedBefore, type Candle } from '@/lib/market/candles';
import { sessionStart } from '@/lib/market/session';
import { buildViews } from '@/lib/strategy';
import type { Views } from '@/lib/strategy/types';
import { loadHistory } from './data';

const days = Number(process.argv[2] ?? 21);
/** Forward horizons in one-minute bars. */
const HORIZONS = [5, 15, 30, 60];

const window = (series: Candle[], size: number) => (series.length > size ? series.slice(-size) : series);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Snapshot {
  views: Views;
  vwap: number | null;
  entryCandles: Candle[];
  index: number;
  /** The other instrument's one-minute closes, aligned by timestamp. */
  peer: Map<number, number>;
  sessionOpen: number;
}

/** Return of the other market over the last `minutes`, normalised by its own move. */
function peerReturn(snapshot: Snapshot, minutes: number): number {
  const now = snapshot.entryCandles[snapshot.index].closeTime;
  const then = snapshot.peer.get(now - minutes * 60_000);
  const current = snapshot.peer.get(now);
  if (then === undefined || current === undefined || then === 0) return 0;
  return ((current - then) / then) * 100;
}

/**
 * Candidate predictors. Each returns a signed number: positive means "expect
 * price to rise". Values are divided by ATR so gold and oil are comparable.
 */
const FEATURES: Record<string, (s: Snapshot) => number> = {
  'ema9-20 5m': ({ views: v }) => (v.setup.ema9 - v.setup.ema20) / v.setup.atr,
  'ema20-50 5m': ({ views: v }) => (v.setup.ema50 === null ? 0 : (v.setup.ema20 - v.setup.ema50) / v.setup.atr),
  'ema9-20 15m': ({ views: v }) => (v.direction.ema9 - v.direction.ema20) / v.direction.atr,
  'ema9-20 1H': ({ views: v }) => (v.context.ema9 - v.context.ema20) / v.context.atr,
  'ema9-20 1m': ({ views: v }) => (v.entry.ema9 - v.entry.ema20) / v.entry.atr,

  'extension 5m': ({ views: v }) => (v.setup.close - v.setup.ema20) / v.setup.atr,
  'extension 1m': ({ views: v }) => (v.entry.close - v.entry.ema9) / v.entry.atr,
  'extension 15m': ({ views: v }) => (v.direction.close - v.direction.ema20) / v.direction.atr,

  'rsi 5m': ({ views: v }) => (v.setup.rsi - 50) / 20,
  'rsi 1m': ({ views: v }) => (v.entry.rsi - 50) / 20,
  'rsi 15m': ({ views: v }) => (v.direction.rsi - 50) / 20,

  'vs vwap': ({ views: v, vwap }) => (vwap === null ? 0 : (v.setup.close - vwap) / v.setup.atr),

  'structure 5m': ({ views: v }) => (v.setup.structure === 'up' ? 1 : v.setup.structure === 'down' ? -1 : 0),
  'structure 15m': ({ views: v }) => (v.direction.structure === 'up' ? 1 : v.direction.structure === 'down' ? -1 : 0),

  'range position': ({ views: v }) => {
    const { high, low } = rangeOf(v.setup.candles, 24);
    return high === low ? 0 : ((v.setup.close - low) / (high - low)) * 2 - 1;
  },

  'return 5m': ({ entryCandles: c, index: i, views: v }) =>
    i >= 5 ? (c[i].close - c[i - 5].close) / v.setup.atr : 0,
  'return 15m': ({ entryCandles: c, index: i, views: v }) =>
    i >= 15 ? (c[i].close - c[i - 15].close) / v.setup.atr : 0,
  'return 60m': ({ entryCandles: c, index: i, views: v }) =>
    i >= 60 ? (c[i].close - c[i - 60].close) / v.setup.atr : 0,
  'return 240m': ({ entryCandles: c, index: i, views: v }) =>
    i >= 240 ? (c[i].close - c[i - 240].close) / v.setup.atr : 0,

  'body 1m': ({ views: v }) => {
    const c = v.entry.candles[v.entry.candles.length - 1];
    return (c.close - c.open) / v.entry.atr;
  },
  'body 3x1m': ({ views: v }) => {
    const c = v.entry.candles.slice(-3);
    return c.reduce((sum, bar) => sum + (bar.close - bar.open), 0) / v.entry.atr;
  },
  'wick balance 1m': ({ views: v }) => {
    const c = v.entry.candles[v.entry.candles.length - 1];
    const range = c.high - c.low;
    if (range <= 0) return 0;
    return ((Math.min(c.open, c.close) - c.low) - (c.high - Math.max(c.open, c.close))) / range;
  },

  'atr ratio 1m': ({ views: v }) => v.entry.atrRatio - 1,
  'atr ratio 5m': ({ views: v }) => v.setup.atrRatio - 1,

  // --- Volume -------------------------------------------------------------
  'volume ratio': ({ views: v }) => {
    const recent = v.setup.candles.slice(-30).map((c) => c.volume);
    const baseline = recent.slice(0, 25).reduce((a, b) => a + b, 0) / 25;
    return baseline > 0 ? v.setup.candles[v.setup.candles.length - 1].volume / baseline - 1 : 0;
  },
  'volume x direction': ({ views: v }) => {
    const last = v.setup.candles[v.setup.candles.length - 1];
    const recent = v.setup.candles.slice(-30, -1).map((c) => c.volume);
    const baseline = recent.reduce((a, b) => a + b, 0) / Math.max(recent.length, 1);
    const weight = baseline > 0 ? clamp(last.volume / baseline, 0, 3) : 1;
    return (weight * (last.close - last.open)) / v.setup.atr;
  },

  // --- Exhaustion ---------------------------------------------------------
  'move z 30m': ({ entryCandles: c, index: i, views: v }) =>
    i >= 30 ? -(c[i].close - c[i - 30].close) / (v.setup.atr * 2) : 0,
  'move z 120m': ({ entryCandles: c, index: i, views: v }) =>
    i >= 120 ? -(c[i].close - c[i - 120].close) / (v.setup.atr * 4) : 0,
  'from session open': ({ entryCandles: c, index: i, views: v, sessionOpen }) =>
    sessionOpen > 0 ? (c[i].close - sessionOpen) / v.setup.atr : 0,

  // --- The other market ---------------------------------------------------
  'peer 15m': (s) => peerReturn(s, 15) * 5,
  'peer 60m': (s) => peerReturn(s, 60) * 3,
};

interface Row {
  features: number[];
  forward: number[];
  hour: number;
  /** Absolute move over the middle horizon, for judging whether a scalp can pay. */
  swing: number;
  spreadRatio: number;
}

/** Pearson correlation, the information coefficient of a feature. */
function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 30) return 0;
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

const names = Object.keys(FEATURES);

async function collect(
  instrumentId: string,
  data: Awaited<ReturnType<typeof loadHistory>>,
  peer: Map<number, number>,
): Promise<Row[]> {
  const { candles } = data;
  const entryCandles = candles.entry;
  const start = Math.max(CANDLE_DEPTH.entry, entryCandles.length - days * 1440);
  const horizonMax = Math.max(...HORIZONS);
  const rows: Row[] = [];

  for (let i = start; i < entryCandles.length - horizonMax; i += 1) {
    const bar = entryCandles[i];
    const now = bar.closeTime;
    const views = buildViews({
      context: window(closedBefore(candles.context, now), CANDLE_DEPTH.context),
      direction: window(closedBefore(candles.direction, now), CANDLE_DEPTH.direction),
      setup: window(closedBefore(candles.setup, now), CANDLE_DEPTH.setup),
      entry: window(entryCandles.slice(0, i + 1), CANDLE_DEPTH.entry),
    } as Record<TimeframeRole, Candle[]>);
    if (!views) continue;

    const openBar = entryCandles.find((candle) => candle.time >= sessionStart(now));
    const snapshot: Snapshot = {
      views,
      vwap: sessionVwap(views.setup.candles, sessionStart(now)),
      entryCandles,
      index: i,
      peer,
      sessionOpen: openBar?.open ?? 0,
    };
    const atr = views.setup.atr;
    const forward = HORIZONS.map((h) => (entryCandles[i + h].close - bar.close) / atr);

    rows.push({
      features: names.map((name) => clamp(FEATURES[name](snapshot), -8, 8)),
      forward,
      hour: new Date(now).getUTCHours(),
      swing: Math.abs(forward[2]),
      spreadRatio: bar.spread / atr,
    });
  }

  console.log(`  ${instrumentId}: ${rows.length} rows`);
  return rows;
}

function report(label: string, rows: Row[]) {
  const half = Math.floor(rows.length / 2);
  const halves = [rows.slice(0, half), rows.slice(half)];

  console.log(`\n================ ${label} ================`);
  console.log('Information coefficient by horizon, first half / second half.');
  console.log('Usable only when both halves share a sign at the same horizon.\n');
  console.log(
    `${'feature'.padEnd(17)}` + HORIZONS.map((h) => `${h + 'm'}`.padStart(17)).join('') + '   verdict',
  );

  const scored = names.map((name, index) => {
    const perHorizon = HORIZONS.map((_, h) =>
      halves.map((part) =>
        correlation(part.map((row) => row.features[index]), part.map((row) => row.forward[h])),
      ),
    );
    const consistent = perHorizon
      .map((ics, h) => ({ h, ics }))
      .filter(({ ics }) => Math.sign(ics[0]) === Math.sign(ics[1]) && Math.min(...ics.map(Math.abs)) >= 0.025);
    return { name, index, perHorizon, consistent };
  });

  for (const { name, perHorizon, consistent } of scored.sort(
    (a, b) => b.consistent.length - a.consistent.length,
  )) {
    const cells = perHorizon
      .map(([a, b]) => `${a.toFixed(3)}/${b.toFixed(3)}`.padStart(17))
      .join('');
    const verdict = consistent
      .map(({ h, ics }) => `${HORIZONS[h]}m ${ics[0] > 0 ? '+' : '-'}`)
      .join(' ');
    console.log(`${name.padEnd(17)}${cells}   ${verdict}`);
  }

  // A linear correlation can miss a relationship that only lives in the tails.
  console.log('\nQuintile check: mean 30m move (ATR) per feature bucket, 1st half | 2nd half');
  const survivors = scored.filter((entry) => entry.consistent.length > 0).slice(0, 6);
  const candidates = survivors.length > 0 ? survivors : scored.slice(0, 4);
  for (const { name, index } of candidates) {
    const buckets = halves.map((part) => {
      const sorted = [...part].sort((a, b) => a.features[index] - b.features[index]);
      const size = Math.floor(sorted.length / 5);
      return Array.from({ length: 5 }, (_, q) => {
        const slice = sorted.slice(q * size, (q + 1) * size);
        return slice.reduce((sum, row) => sum + row.forward[2], 0) / Math.max(slice.length, 1);
      });
    });
    console.log(
      `${name.padEnd(17)} ${buckets[0].map((v) => v.toFixed(3).padStart(7)).join('')}  |${buckets[1].map((v) => v.toFixed(3).padStart(7)).join('')}`,
    );
  }

  // Intraday seasonality: does the clock itself carry a direction?
  console.log('\nDirectional bias by hour (UTC): mean 60m move in ATR, 1st half | 2nd half');
  console.log(`${'hour'.padEnd(6)} ${'1st'.padStart(8)} ${'2nd'.padStart(8)}   consistent`);
  for (let hour = 0; hour < 24; hour += 1) {
    const parts = halves.map((part) => part.filter((row) => row.hour === hour));
    if (parts.some((part) => part.length < 100)) continue;
    const means = parts.map((part) => part.reduce((sum, row) => sum + row.forward[3], 0) / part.length);
    const agree = Math.sign(means[0]) === Math.sign(means[1]) && Math.min(...means.map(Math.abs)) > 0.15;
    console.log(
      `${(String(hour).padStart(2, '0') + ':00').padEnd(6)} ${means[0].toFixed(3).padStart(8)} ${means[1].toFixed(3).padStart(8)}   ${agree ? (means[0] > 0 ? 'UP' : 'DOWN') : ''}`,
    );
  }

  console.log('\nBy hour (UTC): average absolute 30m move vs the spread it has to pay.');
  console.log(`${'hour'.padEnd(6)} ${'bars'.padStart(6)} ${'|move| ATR'.padStart(11)} ${'spread/ATR'.padStart(11)} ${'move/spread'.padStart(12)}`);
  for (let hour = 0; hour < 24; hour += 1) {
    const inHour = rows.filter((row) => row.hour === hour);
    if (inHour.length < 50) continue;
    const move = inHour.reduce((sum, row) => sum + row.swing, 0) / inHour.length;
    const spread = inHour.reduce((sum, row) => sum + row.spreadRatio, 0) / inHour.length;
    console.log(
      `${(String(hour).padStart(2, '0') + ':00').padEnd(6)} ${String(inHour.length).padStart(6)} ${move.toFixed(3).padStart(11)} ${spread.toFixed(3).padStart(11)} ${(move / spread).toFixed(1).padStart(12)}`,
    );
  }
}

async function main() {
  const loaded = new Map<string, Awaited<ReturnType<typeof loadHistory>>>();
  for (const instrument of INSTRUMENTS) loaded.set(instrument.id, await loadHistory(instrument, days));

  for (const instrument of INSTRUMENTS) {
    const other = INSTRUMENTS.find((candidate) => candidate.id !== instrument.id)!;
    const peer = new Map(
      loaded.get(other.id)!.candles.entry.map((candle) => [candle.closeTime, candle.close]),
    );
    const rows = await collect(instrument.id, loaded.get(instrument.id)!, peer);
    report(instrument.label, rows);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
