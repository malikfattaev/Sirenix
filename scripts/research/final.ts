/**
 * Full due diligence on the chosen configuration, plus the honest picture of
 * what happens when the target is pulled in far enough to chase a 70% win rate.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/final.ts [bars]
 */
import { atr as atrSeries, ema, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from '../lib/hourly';
import { UNIVERSE } from '../lib/universe';

const bars = Number(process.argv[2] ?? 5000);
const WARMUP = 220;
const COOLDOWN_HOURS = 6;

interface Config {
  threshold: number;
  stopAtr: number;
  targetAtr: number;
  holdHours: number;
}

const CHOSEN: Config = { threshold: 1.3, stopAtr: 6, targetAtr: 3, holdHours: 48 };

interface Trade {
  epic: string;
  direction: 'LONG' | 'SHORT';
  openedAt: number;
  r: number;
  win: boolean;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

interface Prepared {
  epic: string;
  candles: Candle[];
  score: (number | null)[];
  atr: (number | null)[];
}

function prepare(epic: string, candles: Candle[]): Prepared {
  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);
  const score = candles.map((_, i) => {
    const a = atr[i];
    const e = ema20[i];
    const r = rsi[i];
    if (!a || e === null || r === null || i < 24) return null;
    return -mean([(closes[i] - closes[i - 24]) / a, (r - 50) / 20, (closes[i] - e) / a]);
  });
  return { epic, candles, score, atr };
}

function simulate({ epic, candles, score, atr }: Prepared, config: Config): Trade[] {
  const trades: Trade[] = [];
  let nextBar = WARMUP;
  for (let i = WARMUP; i < candles.length - config.holdHours; i += 1) {
    if (i < nextBar) continue;
    const value = score[i];
    const a = atr[i];
    if (value === null || !a || Math.abs(value) < config.threshold) continue;

    const isLong = value > 0;
    const s = isLong ? 1 : -1;
    const spread = candles[i].spread;
    const entry = candles[i].close + (s * spread) / 2;
    const stop = entry - s * config.stopAtr * a;
    const target = entry + s * config.targetAtr * a;

    let exitIndex = Math.min(candles.length - 1, i + config.holdHours);
    let exitPrice = candles[exitIndex].close;
    for (let j = i + 1; j <= Math.min(candles.length - 1, i + config.holdHours); j += 1) {
      if (isLong ? candles[j].low <= stop : candles[j].high >= stop) {
        exitIndex = j; exitPrice = stop; break;
      }
      if (isLong ? candles[j].high >= target : candles[j].low <= target) {
        exitIndex = j; exitPrice = target; break;
      }
    }
    const move = s * (exitPrice - entry) - spread / 2;
    trades.push({
      epic,
      direction: isLong ? 'LONG' : 'SHORT',
      openedAt: candles[i].closeTime,
      r: move / (config.stopAtr * a),
      win: move > 0,
    });
    nextBar = exitIndex + COOLDOWN_HOURS;
  }
  return trades;
}

async function main() {
  const prepared: Prepared[] = [];
  for (const instrument of UNIVERSE.filter((e) => e.type === 'INDICES')) {
    const candles = await hourlyCandles(instrument.epic, bars);
    if (candles.length > WARMUP + 200) prepared.push(prepare(instrument.epic, candles));
  }

  // --- What chasing a very high win rate actually costs -------------------
  console.log('Pulling the target in raises the win rate and lowers the payoff:\n');
  console.log(`${'target'.padStart(7)} ${'n'.padStart(5)} ${'win%'.padStart(6)} ${'exp'.padStart(8)} ${'total'.padStart(8)} ${'1st/2nd'.padStart(12)}`);
  for (const targetAtr of [1, 1.5, 2, 3, 4, 6]) {
    const trades = prepared.flatMap((p) => simulate(p, { ...CHOSEN, targetAtr }));
    const times = trades.map((t) => t.openedAt).sort((a, b) => a - b);
    const cut = times[Math.floor(times.length / 2)];
    const halves = [
      sum(trades.filter((t) => t.openedAt < cut).map((t) => t.r)),
      sum(trades.filter((t) => t.openedAt >= cut).map((t) => t.r)),
    ];
    console.log(
      `${targetAtr.toFixed(1).padStart(7)} ${String(trades.length).padStart(5)} ` +
        `${((trades.filter((t) => t.win).length / trades.length) * 100).toFixed(1).padStart(6)} ` +
        `${mean(trades.map((t) => t.r)).toFixed(3).padStart(8)} ${sum(trades.map((t) => t.r)).toFixed(1).padStart(8)} ` +
        `${`${halves[0].toFixed(0)}/${halves[1].toFixed(0)}`.padStart(12)}`,
    );
  }

  // --- Full check on the chosen configuration ----------------------------
  const all = prepared.flatMap((p) => simulate(p, CHOSEN));
  console.log(
    `\n=== chosen: score>${CHOSEN.threshold}, stop ${CHOSEN.stopAtr} ATR, target ${CHOSEN.targetAtr} ATR, hold ${CHOSEN.holdHours}h ===`,
  );
  console.log(
    `${all.length} trades, win ${((all.filter((t) => t.win).length / all.length) * 100).toFixed(1)}%, ` +
      `expectancy ${mean(all.map((t) => t.r)).toFixed(3)}R, total ${sum(all.map((t) => t.r)).toFixed(1)}R`,
  );

  const perEpic = [...new Set(all.map((t) => t.epic))].map((epic) => {
    const subset = all.filter((t) => t.epic === epic);
    return { epic, n: subset.length, win: (subset.filter((t) => t.win).length / subset.length) * 100, total: sum(subset.map((t) => t.r)) };
  });
  console.log(`\nPer instrument (${perEpic.filter((e) => e.total > 0).length} of ${perEpic.length} positive):`);
  for (const entry of perEpic.sort((a, b) => b.total - a.total)) {
    console.log(`  ${entry.epic.padEnd(8)} n=${String(entry.n).padStart(4)} win=${entry.win.toFixed(1).padStart(5)}% ${entry.total.toFixed(1).padStart(7)}R`);
  }

  const months = new Map<string, Trade[]>();
  for (const trade of all) {
    const key = new Date(trade.openedAt).toISOString().slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), trade]);
  }
  const monthly = [...months].sort();
  console.log(`\nPer month (${monthly.filter(([, t]) => sum(t.map((x) => x.r)) > 0).length} of ${monthly.length} positive):`);
  for (const [month, subset] of monthly) {
    const total = sum(subset.map((t) => t.r));
    console.log(
      `  ${month} n=${String(subset.length).padStart(4)} win=${((subset.filter((t) => t.win).length / subset.length) * 100).toFixed(0).padStart(3)}% ${total.toFixed(1).padStart(7)}R ` +
        (total > 0 ? '+'.repeat(Math.min(Math.round(total), 24)) : '-'.repeat(Math.min(Math.round(-total), 24))),
    );
  }

  for (const direction of ['LONG', 'SHORT'] as const) {
    const subset = all.filter((t) => t.direction === direction);
    console.log(
      `\n${direction}: n=${subset.length} win=${((subset.filter((t) => t.win).length / subset.length) * 100).toFixed(1)}% total=${sum(subset.map((t) => t.r)).toFixed(1)}R`,
    );
  }

  // Correlated indices signalling together are one bet, not sixteen.
  const days = new Map<string, Trade[]>();
  for (const trade of all) {
    const key = new Date(trade.openedAt).toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), trade]);
  }
  const dailyR = [...days.values()].map((list) => sum(list.map((t) => t.r)));
  const m = mean(dailyR);
  const sd = Math.sqrt(mean(dailyR.map((r) => (r - m) ** 2)));
  console.log(
    `\nIndependence check: ${days.size} active days, ${(all.length / days.size).toFixed(1)} trades/day, ` +
      `mean ${m.toFixed(3)}R/day, t = ${(m / (sd / Math.sqrt(days.size))).toFixed(2)}`,
  );
}

main().catch((error) => { console.error(error); process.exit(1); });
