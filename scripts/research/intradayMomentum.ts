/**
 * Market intraday momentum, tested the way the paper defines it.
 *
 * Gao, Han, Li and Zhou (Journal of Financial Economics, 2018) find that the
 * first half-hour return of the session, measured from the previous close,
 * predicts the last half-hour return, on the S&P 500 and on ten other heavily
 * traded ETFs, and more strongly on volatile days, busy days and macro release
 * days. The hold is thirty minutes, which is the only reason any of this is
 * relevant here: every effect that has tested positive on this data so far
 * needed a day or more, and this account cannot hold a position for two hours.
 *
 * The hourly screen in `sessionEdges.ts` found nothing, but it could not have
 * found much: an hour is twice the window the effect is defined on, and the
 * session boundaries there were fixed while New York's shift twice a year. This
 * is the same question asked properly.
 *
 * Two things are done differently from the screen, and both matter:
 *
 *  - Half-hour returns, built from two fifteen-minute candles, as published.
 *  - The session is found in the data rather than declared. For each calendar
 *    month the volume of every slot of the day is averaged, and the session is
 *    the run of slots that carry the volume. Daylight saving then takes care of
 *    itself, and so does every market whose hours this author would have had to
 *    look up and would eventually have got wrong.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/intradayMomentum.ts [bars]
 */
import { atr as atrSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import { cachedCandles } from '../lib/candles';
import { byDate, sessionsByMonth, slotter } from '../lib/sessions';
import { describe, mean, median } from '../lib/stats';

const bars = Number(process.argv[2] ?? 20000);

/** Fifteen-minute bars, so a half-hour is two of them. */
const SLOTS_PER_HALF_HOUR = 2;
const SLOTS_PER_DAY = 96;

/** A slot counts as part of the session while it carries this share of the busiest one. */
const SESSION_VOLUME_SHARE = 0.35;

const MARKETS = [
  'US30', 'US500', 'US100', 'RTY', 'DE40', 'FR40', 'NL25', 'UK100',
  'J225', 'HK50', 'GOLD', 'OIL_BRENT', 'OIL_CRUDE',
];

/** Which fifteen-minute slot of the UTC day a candle closes in. */
const slotOf = slotter(SLOTS_PER_DAY);

interface Day {
  /** First half-hour return since the previous session's close, in ATR. */
  first: number;
  /** Last half-hour return — what the rule is trying to predict. */
  last: number;
  /** The round trip on the closing trade, in the same ATR units. */
  cost: number;
  volume: number;
  range: number;
}

function daysOf(candles: Candle[]): Day[] {
  const atr = atrSeries(candles, 14 * 4);
  const sessions = sessionsByMonth(candles, SLOTS_PER_DAY, {
    share: SESSION_VOLUME_SHARE,
    minSlots: SLOTS_PER_HALF_HOUR * 4,
  });

  const raw: Day[] = [];
  let previousClose: number | null = null;

  for (const [date, list] of [...byDate(candles).entries()].sort()) {
    const session = sessions.get(date.slice(0, 7));
    if (!session) continue;

    const at = (slot: number) => list.find((entry) => slotOf(entry.candle.closeTime) === slot);
    // The first half-hour ends two slots after the session's first slot closes.
    const openEnd = at(session.open + SLOTS_PER_HALF_HOUR - 1);
    const closeEnd = at(session.close);
    const closeStart = at(session.close - SLOTS_PER_HALF_HOUR);

    if (!openEnd || !closeEnd || !closeStart) {
      if (closeEnd) previousClose = closeEnd.candle.close;
      continue;
    }

    const a = atr[openEnd.index];
    if (a && a > 0 && previousClose !== null) {
      const inSession = list.filter((entry) => {
        const slot = slotOf(entry.candle.closeTime);
        return slot >= session.open && slot <= session.close;
      });
      const high = Math.max(...inSession.map((entry) => entry.candle.high));
      const low = Math.min(...inSession.map((entry) => entry.candle.low));

      raw.push({
        first: (openEnd.candle.close - previousClose) / a,
        last: (closeEnd.candle.close - closeStart.candle.close) / a,
        cost: closeEnd.candle.spread / a,
        volume: inSession.reduce((sum, entry) => sum + entry.candle.volume, 0),
        range: (high - low) / a,
      });
    }

    previousClose = closeEnd.candle.close;
  }

  const volumes = median(raw.map((day) => day.volume));
  const ranges = median(raw.map((day) => day.range));
  return raw.map((day) => ({
    ...day,
    volume: volumes > 0 ? day.volume / volumes : 1,
    range: ranges > 0 ? day.range / ranges : 1,
  }));
}

/** Take the side the first half-hour went, hold the last half-hour, pay once. */
const payoff = (day: Day) => Math.sign(day.first) * day.last - day.cost;

/** The same trade taken the other way, which is a different trade and pays the spread too. */
const fade = (day: Day) => -Math.sign(day.first) * day.last - day.cost;

/** What the rule predicts before the spread is taken out of it. */
const gross = (day: Day) => Math.sign(day.first) * day.last;

function line(name: string, days: Day[], rule: (day: Day) => number = payoff): string {
  if (days.length < 30) return `  ${name.padEnd(30)} only ${days.length} days`;
  const whole = describe(days.map(rule));
  const half = Math.floor(days.length / 2);
  const first = describe(days.slice(0, half).map(rule));
  const second = describe(days.slice(half).map(rule));
  const survives = Math.min(first.mean, second.mean) > 0 && whole.median > 0 && whole.t > 2;

  return (
    `  ${name.padEnd(30)} ${whole.mean.toFixed(4).padStart(8)} ${whole.median.toFixed(4).padStart(8)} ` +
    `${(whole.hit * 100).toFixed(0).padStart(4)}% ${whole.t.toFixed(2).padStart(6)} ` +
    `${first.mean.toFixed(4).padStart(8)} ${second.mean.toFixed(4).padStart(8)} ${String(whole.n).padStart(5)}` +
    (survives ? '  <-- SURVIVES' : '')
  );
}

async function main() {
  console.log(`Loading ${bars} fifteen-minute candles for ${MARKETS.length} markets...\n`);

  const header =
    `  ${'market / filter'.padEnd(30)} ${'mean'.padStart(8)} ${'median'.padStart(8)} ${'hit'.padStart(5)} ` +
    `${'t'.padStart(6)} ${'first'.padStart(8)} ${'second'.padStart(8)} ${'n'.padStart(5)}`;
  console.log(header);

  const all: Day[] = [];
  for (const epic of MARKETS) {
    try {
      const candles = await cachedCandles(epic, 'MINUTE_15', bars);
      const days = daysOf(candles);
      all.push(...days);
      console.log(line(epic, days));
    } catch (error) {
      console.error(`${epic}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log('\n===== pooled, and on the days the paper says are stronger =====');
  console.log(header);
  console.log(line('every day', all));
  console.log(line('busy days', all.filter((day) => day.volume > 1)));
  console.log(line('volatile days', all.filter((day) => day.range > 1)));
  console.log(line('busy and volatile', all.filter((day) => day.volume > 1 && day.range > 1)));
  console.log(line('big first half-hour', all.filter((day) => Math.abs(day.first) > 0.5)));
  console.log(
    line('big first half-hour, busy', all.filter((day) => Math.abs(day.first) > 0.5 && day.volume > 1)),
  );
  console.log(line('top decile first half-hour', (() => {
    const sorted = [...all].sort((a, b) => Math.abs(b.first) - Math.abs(a.first));
    return sorted.slice(0, Math.floor(sorted.length * 0.1));
  })()));

  // A result this negative has two possible readings and they lead opposite ways:
  // either the prediction is backwards, in which case fading it is the trade, or
  // the prediction is nothing and the spread is the whole number. Splitting the
  // payoff into its two parts says which, and the fade is then priced properly —
  // it is a trade of its own and pays the spread on its own.
  console.log('\n===== is it the sign or the spread? =====');
  console.log(header);
  console.log(line('momentum, before costs', all, gross));
  console.log(line('momentum, after costs', all, payoff));
  console.log(line('fade, after costs', all, fade));
  console.log(line('fade, busy and volatile', all.filter((day) => day.volume > 1 && day.range > 1), fade));
  console.log(line('fade, big first half-hour', all.filter((day) => Math.abs(day.first) > 0.5), fade));
  console.log(`\n  the spread on the closing trade averages ${mean(all.map((day) => day.cost)).toFixed(4)} ATR`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
