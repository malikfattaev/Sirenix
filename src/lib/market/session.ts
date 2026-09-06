import { SESSION } from '@/lib/config';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Start of the trading session `time` belongs to. These CFDs roll over daily at
 * {@link SESSION.rolloverHourUtc}, so anything before that hour still belongs to
 * the session that began the previous calendar day.
 */
export function sessionStart(time: number): number {
  const date = new Date(time);
  const anchor = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    SESSION.rolloverHourUtc,
  );
  return time >= anchor ? anchor : anchor - DAY_MS;
}

/** End of the opening range window for the session containing `time`. */
export function openingRangeEnd(time: number): number {
  return sessionStart(time) + SESSION.openingRangeMinutes * 60_000;
}

/** Minutes elapsed since the session opened. */
export function minutesIntoSession(time: number): number {
  return (time - sessionStart(time)) / 60_000;
}
