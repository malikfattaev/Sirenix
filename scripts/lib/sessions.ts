/** When each market actually trades, read out of its own volume. */
import { median } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';

export interface Session {
  /** First slot of the day that carries real volume. */
  open: number;
  /** Last one. */
  close: number;
}

/**
 * The session, found in the data rather than declared.
 *
 * These are CFDs and most of them quote nearly around the clock, but the
 * effects worth testing belong to the cash session underneath: the open is when
 * the day's positioning happens and the close is when it is unwound. Writing
 * those hours down by hand means looking up thirteen exchanges, getting one of
 * them wrong, and being wrong twice a year on all of the ones that move with
 * daylight saving.
 *
 * So each calendar month is measured separately and the session is taken to be
 * the run of slots carrying at least `share` of the busiest slot's volume.
 * Daylight saving then takes care of itself, and a market that shifts its hours
 * is followed rather than smeared across both sets of them.
 *
 * A month whose volume says nothing — a market that reports none at all, or one
 * with too few active slots to hold a session — is left out rather than guessed
 * at, so a caller asking for a month it has no reading on gets nothing back.
 */
export function sessionsByMonth(
  candles: Candle[],
  slotsPerDay: number,
  options: { share?: number; minSlots?: number } = {},
): Map<string, Session> {
  const share = options.share ?? 0.35;
  const minSlots = options.minSlots ?? 4;
  const slotOf = slotter(slotsPerDay);

  const byMonth = new Map<string, number[][]>();
  for (const candle of candles) {
    const month = monthOf(candle.closeTime);
    const slots = byMonth.get(month) ?? Array.from({ length: slotsPerDay }, () => [] as number[]);
    slots[slotOf(candle.closeTime)].push(candle.volume);
    byMonth.set(month, slots);
  }

  const sessions = new Map<string, Session>();
  for (const [month, slots] of byMonth) {
    const typical = slots.map((values) => (values.length ? median(values) : 0));
    const busiest = Math.max(...typical);
    if (busiest <= 0) continue;

    const active = typical
      .map((value, slot) => ({ value, slot }))
      .filter((entry) => entry.value >= busiest * share)
      .map((entry) => entry.slot);
    if (active.length < minSlots) continue;

    sessions.set(month, { open: Math.min(...active), close: Math.max(...active) });
  }
  return sessions;
}

/** Which slot of the UTC day a moment falls in, at the given resolution. */
export function slotter(slotsPerDay: number): (time: number) => number {
  const minutes = (24 * 60) / slotsPerDay;
  return (time: number) => {
    const date = new Date(time);
    return Math.floor((date.getUTCHours() * 60 + date.getUTCMinutes()) / minutes);
  };
}

export const dateOf = (time: number) => new Date(time).toISOString().slice(0, 10);
export const monthOf = (time: number) => new Date(time).toISOString().slice(0, 7);

/** Candles grouped by UTC date, each keeping its index in the original series. */
export function byDate(candles: Candle[]): Map<string, { index: number; candle: Candle }[]> {
  const days = new Map<string, { index: number; candle: Candle }[]>();
  for (const [index, candle] of candles.entries()) {
    const date = dateOf(candle.closeTime);
    const list = days.get(date) ?? [];
    list.push({ index, candle });
    days.set(date, list);
  }
  return days;
}
