/**
 * Does a longer hold clear the spread?
 *
 * Minute-scale scalping loses because a one-minute move is smaller than the
 * round trip. This asks the same question at 15-minute resolution, holding for
 * half an hour to two hours, where the move has room to exceed the cost.
 *
 * Every row is measured on both halves of the window: the first is where a
 * setting may look good, the second is where it has to prove it.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/intraday.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { capital } from '@/lib/capital/client';
import { INSTRUMENTS } from '@/lib/config';
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import { toCandles, type Candle } from '@/lib/market/candles';

const BARS = 5000;
const WARMUP = 60;
/** One 15-minute bar. */
const BAR_MINUTES = 15;

interface Config {
  /** Bars the stretch is measured over. */
  lookback: number;
  threshold: number;
  stopAtr: number;
  targetAtr: number;
  /** Bars the trade is held before it is closed at market. */
  hold: number;
  /** Require the signal bar to have already turned back. */
  confirm: boolean;
  /** Trade against the stretch, or with it. */
  side: 'fade' | 'follow';
}

interface Trade {
  instrumentId: string;
  openedAt: number;
  r: number;
  win: boolean;
}

interface Prepared {
  id: string;
  label: string;
  candles: Candle[];
  closes: number[];
  ema20: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
}

function simulate(data: Prepared, config: Config): Trade[] {
  const { candles, closes, ema20, rsi, atr } = data;
  const start = Math.max(WARMUP, config.lookback + 1);
  if (candles.length < start + config.hold) return [];

  const trades: Trade[] = [];
  let nextBar = start;

  for (let i = start; i < candles.length - config.hold; i += 1) {
    if (i < nextBar) continue;
    const a = atr[i];
    const e20 = ema20[i];
    const r = rsi[i];
    if (!a || a <= 0 || e20 === null || r === null) continue;

    const price = closes[i];
    const stretch = ((price - closes[i - config.lookback]) / a + (r - 50) / 20 + (price - e20) / a) / 3;
    if (Math.abs(stretch) < config.threshold) continue;

    // A fade buys weakness; a follow buys strength. Same measurement, opposite sign.
    const isLong = config.side === 'fade' ? stretch < 0 : stretch > 0;
    if (config.confirm && (isLong ? price <= candles[i].open : price >= candles[i].open)) continue;

    const side = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = price + (side * spread) / 2;
    const stop = entry - side * config.stopAtr * a;
    const target = entry + side * config.targetAtr * a;

    const lastIndex = Math.min(candles.length - 1, i + config.hold);
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
    trades.push({
      instrumentId: data.id,
      openedAt: candles[i].closeTime,
      r: move / (config.stopAtr * a),
      win: move > 0,
    });
    nextBar = exitIndex + 2;
  }

  return trades;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

interface Stats {
  n: number;
  winRate: number;
  totalR: number;
}

const stats = (trades: Trade[]): Stats => ({
  n: trades.length,
  winRate: trades.length === 0 ? 0 : (trades.filter((t) => t.win).length / trades.length) * 100,
  totalR: sum(trades.map((t) => t.r)),
});

const cell = (s: Stats) =>
  `${String(s.n).padStart(4)} ${s.winRate.toFixed(0).padStart(3)}% ${((s.totalR > 0 ? '+' : '') + s.totalR.toFixed(1) + 'R').padStart(8)}`;

const CACHE_DIR = path.join(process.cwd(), 'data', 'intraday-cache');

/** Disk-cached 15m history, refreshed each hour. */
async function load(epic: string): Promise<Candle[]> {
  const stamp = new Date().toISOString().slice(0, 13);
  const file = path.join(CACHE_DIR, `${epic}-${BARS}-${stamp}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Candle[];

  const candles = toCandles(await capital.getCandles(epic, 'MINUTE_15', BARS), 'MINUTE_15');
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(candles));
  return candles;
}

async function main() {
  const prepared: Prepared[] = [];
  for (const instrument of INSTRUMENTS) {
    const candles = await load(instrument.epic);
    const closes = candles.map((candle) => candle.close);
    prepared.push({
      id: instrument.id,
      label: instrument.label,
      candles,
      closes,
      ema20: ema(closes, 20),
      rsi: rsiSeries(closes, 14),
      atr: atrSeries(candles, 14),
    });
    console.log(
      `${instrument.label}: ${candles.length} x 15m, ` +
        `${new Date(candles[0].time).toISOString().slice(0, 10)} to ${new Date(candles[candles.length - 1].time).toISOString().slice(0, 10)}`,
    );
  }

  // With arguments, one configuration is reported in detail instead of a grid.
  const [side, lookback, threshold, stopAtr, targetAtr, hold, confirm] = process.argv.slice(2);
  if (side) {
    const config: Config = {
      side: side as Config['side'],
      lookback: Number(lookback),
      threshold: Number(threshold),
      stopAtr: Number(stopAtr),
      targetAtr: Number(targetAtr),
      hold: Number(hold),
      confirm: confirm === 'true',
    };
    const trades = prepared.flatMap((data) => simulate(data, config)).sort((a, b) => a.openedAt - b.openedAt);
    const span = prepared[0].candles;
    const days = (span[span.length - 1].closeTime - span[0].time) / 86_400_000;
    console.log(`\n${JSON.stringify(config)}`);
    console.log(`\nOVERALL      ${cell(stats(trades))}  ${(trades.length / days).toFixed(1)}/day`);

    for (const data of prepared) {
      console.log(`${data.label.padEnd(12)} ${cell(stats(trades.filter((t) => t.instrumentId === data.id)))}`);
    }

    console.log('\nBy month');
    const months = [...new Set(trades.map((t) => new Date(t.openedAt).toISOString().slice(0, 7)))].sort();
    for (const month of months) {
      console.log(
        `  ${month}      ${cell(stats(trades.filter((t) => new Date(t.openedAt).toISOString().slice(0, 7) === month)))}`,
      );
    }

    console.log('\nBy week');
    const week = (time: number) => new Date(time - (new Date(time).getUTCDay() * 86_400_000)).toISOString().slice(0, 10);
    const weeks = [...new Set(trades.map((t) => week(t.openedAt)))].sort();
    const weekly = weeks.map((w) => sum(trades.filter((t) => week(t.openedAt) === w).map((t) => t.r)));
    for (let i = 0; i < weeks.length; i += 1) {
      console.log(`  ${weeks[i]}   ${(weekly[i] > 0 ? '+' : '') + weekly[i].toFixed(1)}R`);
    }
    console.log(`  ${weekly.filter((r) => r > 0).length} of ${weeks.length} weeks positive`);
    return;
  }

  const grid: Config[] = [];
  for (const lookback of [4, 8, 16, 24]) {
    for (const threshold of [0.8, 1.1, 1.4, 1.8]) {
      for (const stopAtr of [1.5, 2.5, 4]) {
        for (const targetAtr of [0.8, 1.2, 2]) {
          for (const hold of [2, 4, 8]) {
            for (const confirm of [false, true]) {
              for (const side of ['fade', 'follow'] as const) {
                grid.push({ lookback, threshold, stopAtr, targetAtr, hold, confirm, side });
              }
            }
          }
        }
      }
    }
  }
  console.log(`\nTesting ${grid.length} configurations, both markets pooled\n`);

  const rows: { config: Config; whole: Stats; first: Stats; second: Stats; perDay: number }[] = [];
  const span = prepared[0].candles;
  const days = (span[span.length - 1].closeTime - span[0].time) / 86_400_000;

  for (const config of grid) {
    const trades = prepared.flatMap((data) => simulate(data, config)).sort((a, b) => a.openedAt - b.openedAt);
    if (trades.length < 60) continue;
    const cutoff = trades[Math.floor(trades.length / 2)].openedAt;
    rows.push({
      config,
      whole: stats(trades),
      first: stats(trades.filter((t) => t.openedAt < cutoff)),
      second: stats(trades.filter((t) => t.openedAt >= cutoff)),
      perDay: trades.length / days,
    });
  }

  const label = (c: Config) =>
    `${c.side} look${c.lookback} th${c.threshold} stop${c.stopAtr} tgt${c.targetAtr} hold${c.hold * BAR_MINUTES}m${c.confirm ? ' confirm' : ''}`;

  const robust = rows.filter((row) => row.first.totalR > 0 && row.second.totalR > 0);
  console.log(`${robust.length} of ${rows.length} configurations positive in BOTH halves\n`);

  console.log(`${'configuration'.padEnd(48)} ${'/day'.padStart(5)}  first half        second half`);
  for (const row of robust.sort((a, b) => b.second.totalR - a.second.totalR).slice(0, 18)) {
    console.log(
      `${label(row.config).padEnd(48)} ${row.perDay.toFixed(1).padStart(5)}  ${cell(row.first)}  ${cell(row.second)}`,
    );
  }

  console.log('\nMost signals among those, win rate 60%+ in both halves:');
  const frequent = robust.filter((row) => row.first.winRate >= 60 && row.second.winRate >= 60);
  if (frequent.length === 0) console.log('  none');
  for (const row of frequent.sort((a, b) => b.perDay - a.perDay).slice(0, 12)) {
    console.log(
      `${label(row.config).padEnd(48)} ${row.perDay.toFixed(1).padStart(5)}  ${cell(row.first)}  ${cell(row.second)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
