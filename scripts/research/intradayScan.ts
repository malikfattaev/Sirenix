/**
 * Ranks markets on the live INTRADAY settings, unchanged.
 *
 * The minute-scale engine is not profitable anywhere, so the market to add is
 * the one the hour-scale continuation signal handles best. Each is scored on
 * both halves of the window; a market that only works in one is noise.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/intradayScan.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { capital } from '@/lib/capital/client';
import { INTRADAY } from '@/lib/config';
import { atr as atrSeries, ema, median, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';

const BARS = 5000;
const WARMUP = 60;
const CACHE_DIR = path.join(process.cwd(), 'data', 'intraday-cache');

const MARKETS: { epic: string; label: string }[] = [
  { epic: 'GOLD', label: 'GOLD' },
  { epic: 'OIL_BRENT', label: 'BRENT OIL' },
  { epic: 'OIL_CRUDE', label: 'WTI CRUDE' },
  { epic: 'SILVER', label: 'SILVER' },
  { epic: 'COPPER', label: 'COPPER' },
  { epic: 'NATURALGAS', label: 'NATURAL GAS' },
  { epic: 'GASOIL', label: 'GASOIL' },
  { epic: 'GASOLINE', label: 'GASOLINE' },
  { epic: 'PLATINUMROLLING', label: 'PLATINUM' },
  { epic: 'PALLADIUMROLLING', label: 'PALLADIUM' },
  { epic: 'WHEAT', label: 'WHEAT' },
  { epic: 'US30', label: 'US 30' },
  { epic: 'US100', label: 'US TECH 100' },
  { epic: 'DE40', label: 'GERMANY 40' },
  { epic: 'UK100', label: 'UK 100' },
  { epic: 'USDJPY', label: 'USD/JPY' },
  { epic: 'BTCUSD', label: 'BITCOIN' },
  { epic: 'ETHUSD', label: 'ETHEREUM' },
];

async function load(epic: string): Promise<Candle[]> {
  const stamp = new Date().toISOString().slice(0, 13);
  const file = path.join(CACHE_DIR, `${epic}-${BARS}-${stamp}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Candle[];

  const candles = toCandles(await capital.getCandles(epic, 'MINUTE_15', BARS), 'MINUTE_15');
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(candles));
  return candles;
}

interface Trade {
  openedAt: number;
  r: number;
  win: boolean;
}

/** The production signal, replayed exactly: continuation, confirmed, timed exit. */
function simulate(candles: Candle[]): Trade[] {
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);

  const trades: Trade[] = [];
  let nextBar = WARMUP;

  for (let i = WARMUP; i < candles.length - INTRADAY.holdBars; i += 1) {
    if (i < nextBar) continue;
    const a = atr[i];
    const e20 = ema20[i];
    const r = rsi[i];
    if (!a || a <= 0 || e20 === null || r === null) continue;

    const price = closes[i];
    const stretch = ((price - closes[i - INTRADAY.lookback]) / a + (r - 50) / 20 + (price - e20) / a) / 3;
    if (Math.abs(stretch) < INTRADAY.threshold) continue;

    const isLong = stretch > 0;
    if (isLong ? price <= candles[i].open : price >= candles[i].open) continue;

    const side = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = price + (side * spread) / 2;
    const stop = entry - side * INTRADAY.stopAtr * a;
    const target = entry + side * INTRADAY.targetAtr * a;

    const lastIndex = Math.min(candles.length - 1, i + INTRADAY.holdBars);
    let exitIndex = lastIndex;
    let exitPrice = closes[lastIndex];
    for (let j = i + 1; j <= lastIndex; j += 1) {
      if (isLong ? candles[j].low <= stop : candles[j].high >= stop) {
        exitIndex = j;
        exitPrice = stop;
        break;
      }
      if (isLong ? candles[j].high >= target : candles[j].low <= target) {
        exitIndex = j;
        exitPrice = target;
        break;
      }
    }

    const move = side * (exitPrice - entry) - spread / 2;
    trades.push({ openedAt: candles[i].closeTime, r: move / (INTRADAY.stopAtr * a), win: move > 0 });
    nextBar = exitIndex + 2;
  }

  return trades;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const stat = (trades: Trade[]) => ({
  n: trades.length,
  win: trades.length === 0 ? 0 : (trades.filter((t) => t.win).length / trades.length) * 100,
  totalR: sum(trades.map((t) => t.r)),
});
const cell = (s: { n: number; win: number; totalR: number }) =>
  `${String(s.n).padStart(3)} ${s.win.toFixed(0).padStart(3)}% ${((s.totalR > 0 ? '+' : '') + s.totalR.toFixed(1) + 'R').padStart(8)}`;

async function main() {
  console.log(`Live INTRADAY settings: ${JSON.stringify(INTRADAY)}\n`);
  console.log(
    `${'market'.padEnd(13)} ${'cost'.padStart(5)} ${'/day'.padStart(5)} ${'win'.padStart(5)} ` +
      `${'total'.padStart(8)}   first half         second half`,
  );

  const rows: { label: string; cost: number; perDay: number; whole: ReturnType<typeof stat>; first: ReturnType<typeof stat>; second: ReturnType<typeof stat> }[] = [];

  for (const market of MARKETS) {
    try {
      const candles = await load(market.epic);
      if (candles.length < 500) continue;
      const trades = simulate(candles);
      if (trades.length < 30) {
        console.log(`${market.label.padEnd(13)} too few signals (${trades.length})`);
        continue;
      }
      const cutoff = trades[Math.floor(trades.length / 2)].openedAt;
      const days = (candles[candles.length - 1].closeTime - candles[0].time) / 86_400_000;
      // Spread against the 15-minute move it has to clear.
      const atr = atrSeries(candles, 14);
      const cost =
        median(candles.slice(-300).map((c) => c.spread)) /
        (median(atr.slice(-300).filter((v): v is number => v !== null)) || 1);

      const row = {
        label: market.label,
        cost,
        perDay: trades.length / days,
        whole: stat(trades),
        first: stat(trades.filter((t) => t.openedAt < cutoff)),
        second: stat(trades.filter((t) => t.openedAt >= cutoff)),
      };
      rows.push(row);
      console.log(
        `${row.label.padEnd(13)} ${row.cost.toFixed(2).padStart(5)} ${row.perDay.toFixed(1).padStart(5)} ` +
          `${row.whole.win.toFixed(0).padStart(4)}% ` +
          `${((row.whole.totalR > 0 ? '+' : '') + row.whole.totalR.toFixed(1) + 'R').padStart(8)}   ` +
          `${cell(row.first)}  ${cell(row.second)}`,
      );
    } catch (error) {
      console.log(`${market.label.padEnd(13)} unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  const good = rows
    .filter((row) => row.first.totalR > 0 && row.second.totalR > 0)
    .sort((a, b) => a.first.totalR + a.second.totalR > b.first.totalR + b.second.totalR ? -1 : 1);
  console.log(`\nPositive in BOTH halves, best first:`);
  for (const row of good) {
    console.log(`  ${row.label.padEnd(13)} ${row.perDay.toFixed(1)}/day  ${row.whole.win.toFixed(0)}% win  +${row.whole.totalR.toFixed(1)}R`);
  }
  if (good.length === 0) console.log('  none');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
