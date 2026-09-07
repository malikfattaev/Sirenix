/**
 * Looks for a reversion configuration that fires more often and wins more often,
 * across the whole traded universe rather than the indices alone.
 *
 * Every configuration is scored on the second half of the window only; the first
 * half is reported beside it so that a result which only works in one of the two
 * can be thrown out.
 */
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from './hourly';
import { UNIVERSE, type UniverseEntry } from './universe';

const BARS = 5000;
const WARMUP = 120;
const COOLDOWN_HOURS = 6;

interface Config {
  lookback: number;
  threshold: number;
  stopAtr: number;
  targetAtr: number;
  hold: number;
  confirm: boolean;
}

interface Trade {
  type: UniverseEntry['type'];
  epic: string;
  openedAt: number;
  r: number;
  win: boolean;
}

interface Prepared {
  entry: UniverseEntry;
  candles: Candle[];
  closes: number[];
  ema20: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
}

function prepare(entry: UniverseEntry, candles: Candle[]): Prepared {
  const closes = candles.map((candle) => candle.close);
  return {
    entry,
    candles,
    closes,
    ema20: ema(closes, 20),
    rsi: rsiSeries(closes, 14),
    atr: atrSeries(candles, 14),
  };
}

/** Replays one configuration over one instrument, paying the quoted spread. */
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
    const past = closes[i - config.lookback];
    const score = -((price - past) / a + (r - 50) / 20 + (price - e20) / a) / 3;
    if (Math.abs(score) < config.threshold) continue;

    const isLong = score > 0;
    // Optionally wait for the bar itself to have turned back the other way.
    if (config.confirm) {
      const turned = isLong ? closes[i] > candles[i].open : closes[i] < candles[i].open;
      if (!turned) continue;
    }

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
      type: data.entry.type,
      epic: data.entry.epic,
      openedAt: candles[i].closeTime,
      r: move / (config.stopAtr * a),
      win: move > 0,
    });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }

  return trades;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

interface Stats {
  n: number;
  winRate: number;
  totalR: number;
  perTrade: number;
}

function stats(trades: Trade[]): Stats {
  if (trades.length === 0) return { n: 0, winRate: 0, totalR: 0, perTrade: 0 };
  const total = sum(trades.map((trade) => trade.r));
  return {
    n: trades.length,
    winRate: Number(((trades.filter((trade) => trade.win).length / trades.length) * 100).toFixed(1)),
    totalR: Number(total.toFixed(1)),
    perTrade: Number((total / trades.length).toFixed(3)),
  };
}

const line = (label: string, s: Stats) =>
  `${label.padEnd(18)} n=${String(s.n).padStart(5)}  win=${String(s.winRate).padStart(5)}%  ` +
  `total=${(s.totalR > 0 ? '+' : '') + s.totalR}R`.padEnd(16) + `  per=${s.perTrade}R`;

async function main() {
  // Optional epic list, so one market can be studied on its own.
  const only = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));
  const universe = only.length > 0 ? UNIVERSE.filter((entry) => only.includes(entry.epic)) : UNIVERSE;

  console.log(`Loading ${universe.length} instruments...`);
  const prepared: Prepared[] = [];
  for (const entry of universe) {
    try {
      const candles = await hourlyCandles(entry.epic, BARS);
      if (candles.length > WARMUP + 200) prepared.push(prepare(entry, candles));
    } catch {
      // A missing epic just drops out of the study.
    }
  }
  const spans = prepared.flatMap((data) => [data.candles[0].time, data.candles[data.candles.length - 1].closeTime]);
  const from = Math.min(...spans);
  const to = Math.max(...spans);
  console.log(
    `${prepared.length} loaded, ${new Date(from).toISOString().slice(0, 10)} to ${new Date(to).toISOString().slice(0, 10)}\n`,
  );

  const grid: Config[] = [];
  for (const lookback of [24, 48]) {
    for (const threshold of [1.0, 1.3, 1.6, 2.0, 2.4, 2.8]) {
      for (const stopAtr of [4, 6, 8]) {
        for (const targetAtr of [1.0, 1.5, 2.0, 3.0]) {
          for (const hold of [24, 48]) {
            for (const confirm of [false, true]) {
              grid.push({ lookback, threshold, stopAtr, targetAtr, hold, confirm });
            }
          }
        }
      }
    }
  }
  console.log(`Testing ${grid.length} configurations...\n`);

  const classes = [...new Set(universe.map((entry) => entry.type))];
  const rows: { config: Config; type: string; is: Stats; oos: Stats }[] = [];

  for (const config of grid) {
    const trades = prepared.flatMap((data) => simulate(data, config));
    for (const type of [...classes, 'ALL']) {
      const subset = type === 'ALL' ? trades : trades.filter((trade) => trade.type === type);
      if (subset.length < 40) continue;
      // Split where half the trades fall on each side, so the two samples are
      // comparable even though the instruments have unequal histories.
      const times = subset.map((trade) => trade.openedAt).sort((a, b) => a - b);
      const cutoff = times[Math.floor(times.length / 2)];
      rows.push({
        config,
        type,
        is: stats(subset.filter((trade) => trade.openedAt < cutoff)),
        oos: stats(subset.filter((trade) => trade.openedAt >= cutoff)),
      });
    }
  }

  const label = (config: Config) =>
    `look${config.lookback} th${config.threshold} stop${config.stopAtr} tgt${config.targetAtr} ` +
    `hold${config.hold}${config.confirm ? ' confirm' : ''}`;

  const robust = rows.filter((row) => row.is.totalR > 0 && row.oos.totalR > 0 && row.is.n >= 25 && row.oos.n >= 25);

  console.log('=== Positive in BOTH halves, ranked by out-of-sample total ===');
  for (const row of robust.sort((a, b) => b.oos.totalR - a.oos.totalR).slice(0, 15)) {
    console.log(`${row.type.padEnd(16)} ${label(row.config).padEnd(46)}`);
    console.log(`  ${line('  in-sample', row.is)}`);
    console.log(`  ${line('  out-of-sample', row.oos)}`);
  }

  console.log('\n=== Both halves positive AND out-of-sample win rate >= 70%, most signals first ===');
  const highWin = robust.filter((row) => row.oos.winRate >= 70 && row.is.winRate >= 65);
  if (highWin.length === 0) console.log('  none');
  for (const row of highWin.sort((a, b) => b.oos.n + b.is.n - (a.oos.n + a.is.n)).slice(0, 15)) {
    console.log(`${row.type.padEnd(16)} ${label(row.config).padEnd(46)}`);
    console.log(`  ${line('  in-sample', row.is)}`);
    console.log(`  ${line('  out-of-sample', row.oos)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
