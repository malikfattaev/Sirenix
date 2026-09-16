/**
 * Session-anchored effects: does the start of the day predict the end of it?
 *
 * Every study in this repository so far has asked a continuous question — given
 * what price has done over the last n hours, what does it do next — and has
 * found nothing at one to two hours that survives the spread. This asks a
 * different kind of question, one that is tied to the clock rather than to a
 * rolling window.
 *
 * The idea is not mine. Gao, Han, Li and Zhou (Journal of Financial Economics,
 * 2018) document that on the S&P 500 the first half-hour return since the
 * previous close predicts the last half-hour return, that it holds across ten
 * other heavily traded ETFs, and that it is stronger on volatile days, on high
 * volume days and on days carrying a macroeconomic release. The hold is half an
 * hour, which is the reason it is worth testing here: it fits inside the two
 * hours this account works under, and nothing else that has tested positive
 * does.
 *
 * This is the hourly screen of that idea — the first hour of the session
 * against the last — run on the data already cached. Hourly resolution is
 * coarser than the paper's and will understate a real effect rather than invent
 * one; if it shows nothing at all there is no reason to pay for the finer data.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/sessionEdges.ts [bars]
 */
import { atr as atrSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { hourlyCandles } from '../lib/hourly';
import { describe, median } from '../lib/stats';

const bars = Number(process.argv[2] ?? 5000);

/**
 * When each market's real session runs, in UTC hours.
 *
 * These are CFDs and most of them quote around the clock, but the effect being
 * tested belongs to the cash session underneath: the open is when the day's
 * positioning happens and the close is when it is unwound. `open` is the first
 * hour of the session and `close` the last, both as the hour the candle closes.
 *
 * Gold and the two oils have no cash session of their own, so they are given
 * the New York hours, which is where their volume is.
 */
const SESSIONS: Record<string, { open: number; close: number }> = {
  US30: { open: 15, close: 21 },
  US500: { open: 15, close: 21 },
  US100: { open: 15, close: 21 },
  RTY: { open: 15, close: 21 },
  DE40: { open: 9, close: 16 },
  FR40: { open: 9, close: 16 },
  NL25: { open: 9, close: 16 },
  UK100: { open: 9, close: 16 },
  J225: { open: 1, close: 6 },
  HK50: { open: 2, close: 8 },
  GOLD: { open: 15, close: 21 },
  OIL_BRENT: { open: 15, close: 21 },
  OIL_CRUDE: { open: 15, close: 21 },
};

interface Day {
  date: string;
  /** First-hour return since the previous session's close, in ATR. */
  first: number;
  /** Last-hour return, in ATR — what the rule is trying to predict. */
  last: number;
  /** The round trip on the closing trade, in the same ATR units. */
  cost: number;
  /** Day's volume over its own recent median, so "busy" can be conditioned on. */
  volume: number;
  /** Day's range over its own recent median: the paper's "volatile day". */
  range: number;
}

const hourOf = (time: number) => new Date(time).getUTCHours();
const dateOf = (time: number) => new Date(time).toISOString().slice(0, 10);

function daysOf(candles: Candle[], session: { open: number; close: number }): Day[] {
  const atr = atrSeries(candles, 14);
  const byDate = new Map<string, { index: number; candle: Candle }[]>();

  for (const [index, candle] of candles.entries()) {
    const date = dateOf(candle.closeTime);
    const list = byDate.get(date) ?? [];
    list.push({ index, candle });
    byDate.set(date, list);
  }

  const days: Day[] = [];
  let previousClose: number | null = null;

  for (const [date, list] of [...byDate.entries()].sort()) {
    const open = list.find((entry) => hourOf(entry.candle.closeTime) === session.open);
    const close = list.find((entry) => hourOf(entry.candle.closeTime) === session.close);
    const beforeClose = list.find((entry) => hourOf(entry.candle.closeTime) === session.close - 1);

    if (!open || !close || !beforeClose) {
      if (close) previousClose = close.candle.close;
      continue;
    }

    const a = atr[open.index];
    if (a && a > 0 && previousClose !== null) {
      const inSession = list.filter(
        (entry) =>
          hourOf(entry.candle.closeTime) >= session.open &&
          hourOf(entry.candle.closeTime) <= session.close,
      );
      const volume = inSession.reduce((sum, entry) => sum + entry.candle.volume, 0);
      const high = Math.max(...inSession.map((entry) => entry.candle.high));
      const low = Math.min(...inSession.map((entry) => entry.candle.low));

      days.push({
        date,
        // Since the previous session's close, exactly as the paper defines it.
        first: (open.candle.close - previousClose) / a,
        last: (close.candle.close - beforeClose.candle.close) / a,
        cost: close.candle.spread / a,
        volume,
        range: (high - low) / a,
      });
    }

    previousClose = close.candle.close;
  }

  // Busy and volatile are relative to the market's own recent behaviour.
  const volumes = median(days.map((day) => day.volume));
  const ranges = median(days.map((day) => day.range));
  return days.map((day) => ({
    ...day,
    volume: volumes > 0 ? day.volume / volumes : 1,
    range: ranges > 0 ? day.range / ranges : 1,
  }));
}

/**
 * The trade the paper describes: at the start of the last hour, take the side
 * the first hour went, and hold to the close. The spread is charged once.
 */
const payoff = (day: Day) => Math.sign(day.first) * day.last - day.cost;

function line(name: string, days: Day[]): string {
  if (days.length < 30) return `  ${name.padEnd(30)} only ${days.length} days`;
  const whole = describe(days.map(payoff));
  const half = Math.floor(days.length / 2);
  const first = describe(days.slice(0, half).map(payoff));
  const second = describe(days.slice(half).map(payoff));
  const survives = Math.min(first.mean, second.mean) > 0 && whole.median > 0 && whole.t > 2;

  return (
    `  ${name.padEnd(30)} ${whole.mean.toFixed(4).padStart(8)} ${whole.median.toFixed(4).padStart(8)} ` +
    `${(whole.hit * 100).toFixed(0).padStart(4)}% ${whole.t.toFixed(2).padStart(6)} ` +
    `${first.mean.toFixed(4).padStart(8)} ${second.mean.toFixed(4).padStart(8)} ${String(whole.n).padStart(5)}` +
    (survives ? '  <-- SURVIVES' : '')
  );
}

async function main() {
  console.log(`Loading ${bars} hourly candles for ${Object.keys(SESSIONS).length} markets...\n`);

  const all: Day[] = [];
  const header =
    `  ${'market / filter'.padEnd(30)} ${'mean'.padStart(8)} ${'median'.padStart(8)} ${'hit'.padStart(5)} ` +
    `${'t'.padStart(6)} ${'first'.padStart(8)} ${'second'.padStart(8)} ${'n'.padStart(5)}`;
  console.log(header);

  for (const [epic, session] of Object.entries(SESSIONS)) {
    try {
      const days = daysOf(await hourlyCandles(epic, bars), session);
      all.push(...days);
      console.log(line(epic, days));
    } catch (error) {
      console.error(`${epic}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log('\n===== pooled, and on the days the paper says are stronger =====');
  console.log(header);
  console.log(line('every day', all));
  console.log(line('busy days (volume > median)', all.filter((day) => day.volume > 1)));
  console.log(line('volatile days (range > median)', all.filter((day) => day.range > 1)));
  console.log(line('busy and volatile', all.filter((day) => day.volume > 1 && day.range > 1)));
  console.log(line('big first hour (> 0.5 ATR)', all.filter((day) => Math.abs(day.first) > 0.5)));
  console.log(line('big first hour, busy day', all.filter((day) => Math.abs(day.first) > 0.5 && day.volume > 1)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
