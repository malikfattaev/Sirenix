/**
 * Backtest of the one effect that survived the full research.
 *
 * Equity indices give back part of a sharp move over the following day. The
 * pooled study found this consistent across both halves of a seven-month sample
 * and, unlike everything at scalping horizons, large enough to clear the spread.
 * This turns it into actual trades with entry, stop, target and real costs.
 *
 * Usage: npx tsx --env-file=.env.local scripts/indexFade.ts [bars]
 */
import { capital } from '@/lib/capital/client';
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';
import { UNIVERSE } from './universe';

const bars = Number(process.argv[2] ?? 5000);
const WARMUP = 220;

/** Enter when the fade score clears this; higher means rarer, stronger setups. */
const ENTRY_THRESHOLD = 1.4;
/** One position per instrument, and a pause after each so one move is traded once. */
const COOLDOWN_HOURS = 12;

interface Variant {
  name: string;
  /** Stop and target as multiples of hourly ATR; large values mean "time exit". */
  stopAtr: number;
  targetAtr: number;
  holdHours: number;
}

const VARIANTS: Variant[] = [
  { name: 'stop 3 / target 3 / 24h', stopAtr: 3, targetAtr: 3, holdHours: 24 },
  { name: 'stop 6 / target 3 / 24h', stopAtr: 6, targetAtr: 3, holdHours: 24 },
  { name: 'stop 6 / target 6 / 24h', stopAtr: 6, targetAtr: 6, holdHours: 24 },
  { name: 'time exit only / 12h', stopAtr: 99, targetAtr: 99, holdHours: 12 },
  { name: 'time exit only / 24h', stopAtr: 99, targetAtr: 99, holdHours: 24 },
  { name: 'time exit only / 48h', stopAtr: 99, targetAtr: 99, holdHours: 48 },
];

interface Trade {
  epic: string;
  direction: 'LONG' | 'SHORT';
  openedAt: number;
  r: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  holdHours: number;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function run(epic: string, candles: Candle[], variant: Variant): Trade[] {
  if (candles.length < WARMUP + 100) return [];

  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);

  const trades: Trade[] = [];
  let nextBar = WARMUP;

  for (let i = WARMUP; i < candles.length - variant.holdHours; i += 1) {
    if (i < nextBar) continue;
    const a = atr[i];
    const e20 = ema20[i];
    const r = rsi[i];
    if (!a || e20 === null || r === null) continue;

    const price = closes[i];
    // Fade recent strength: positive score means the market fell and should bounce.
    const score = -mean([
      (price - closes[i - 24]) / a,
      (r - 50) / 20,
      (price - e20) / a,
    ]);
    if (Math.abs(score) < ENTRY_THRESHOLD) continue;

    const isLong = score > 0;
    const s = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = price + (s * spread) / 2;
    const stop = entry - s * variant.stopAtr * a;
    const target = entry + s * variant.targetAtr * a;
    // Risk is measured against the real stop, or the typical move for a time exit.
    const risk = Math.min(variant.stopAtr, 3) * a;

    let exitIndex = Math.min(candles.length - 1, i + variant.holdHours);
    let exitPrice = closes[exitIndex];
    let outcome: Trade['outcome'] = 'TIMEOUT';

    for (let j = i + 1; j <= Math.min(candles.length - 1, i + variant.holdHours); j += 1) {
      // Stop first: when a bar spans both levels, assume the worse fill.
      if (isLong ? candles[j].low <= stop : candles[j].high >= stop) {
        exitIndex = j;
        exitPrice = stop;
        outcome = 'LOSS';
        break;
      }
      if (isLong ? candles[j].high >= target : candles[j].low <= target) {
        exitIndex = j;
        exitPrice = target;
        outcome = 'WIN';
        break;
      }
    }

    const move = s * (exitPrice - entry) - spread / 2;
    trades.push({
      epic,
      direction: isLong ? 'LONG' : 'SHORT',
      openedAt: candles[i].closeTime,
      r: move / risk,
      outcome: outcome === 'TIMEOUT' ? (move > 0 ? 'WIN' : 'LOSS') : outcome,
      holdHours: exitIndex - i,
    });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }

  return trades;
}

function summarise(label: string, trades: Trade[]) {
  if (trades.length === 0) {
    console.log(`${label.padEnd(22)} no trades`);
    return;
  }
  const wins = trades.filter((trade) => trade.r > 0);
  const grossWin = wins.reduce((sum, t) => sum + t.r, 0);
  const grossLoss = trades.filter((t) => t.r <= 0).reduce((sum, t) => sum - t.r, 0);
  console.log(
    `${label.padEnd(22)} n=${String(trades.length).padStart(4)} ` +
      `win=${((wins.length / trades.length) * 100).toFixed(1).padStart(5)}% ` +
      `exp=${mean(trades.map((t) => t.r)).toFixed(3).padStart(7)}R ` +
      `total=${trades.reduce((s, t) => s + t.r, 0).toFixed(1).padStart(7)}R ` +
      `PF=${grossLoss === 0 ? '  inf' : (grossWin / grossLoss).toFixed(2).padStart(5)} ` +
      `hold=${mean(trades.map((t) => t.holdHours)).toFixed(1).padStart(5)}h`,
  );
}

async function main() {
  const indices = UNIVERSE.filter((entry) => entry.type === 'INDICES');
  const history = new Map<string, Candle[]>();
  for (const instrument of indices) {
    try {
      history.set(
        instrument.epic,
        toCandles(await capital.getCandles(instrument.epic, 'HOUR', bars), 'HOUR'),
      );
    } catch (error) {
      console.log(`${instrument.epic}: ${(error as Error).message}`);
    }
  }
  console.log(`loaded ${history.size} indices\n`);

  for (const variant of VARIANTS) {
    const all = [...history.entries()].flatMap(([epic, candles]) => run(epic, candles, variant));
    if (all.length === 0) continue;
    const times = all.map((trade) => trade.openedAt).sort((a, b) => a - b);
    const cutoff = times[Math.floor(times.length / 2)];

    console.log(`--- ${variant.name} ---`);
    summarise('  all', all);
    summarise('  first half', all.filter((trade) => trade.openedAt < cutoff));
    summarise('  second half', all.filter((trade) => trade.openedAt >= cutoff));
    summarise('  long only', all.filter((trade) => trade.direction === 'LONG'));
    summarise('  short only', all.filter((trade) => trade.direction === 'SHORT'));
    console.log('');
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
