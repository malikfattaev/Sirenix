import type { OpeningHours } from '@/lib/capital/types';

/**
 * When a market actually trades.
 *
 * `marketStatus` is not the answer: Brent spot reported TRADEABLE for half an
 * hour after its Monday session closed at 17:30, with a price that had not
 * moved since. The instrument's own `openingHours` is what tells a closed
 * market apart from a broken feed, and the difference between those two is the
 * difference between a tool worth trusting and one that looks stuck.
 */

export interface MarketHours {
  open: boolean;
  /** When the current session ends, if one is running. */
  closesAt: number | null;
  /** When the next session starts, if the market is shut. */
  opensAt: number | null;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_MS = 86_400_000;
/** How far ahead to look for the next session before giving up. */
const SEARCH_DAYS = 8;

/** `"09:30 - 17:30"` as minutes from midnight; a range ending at 00:00 means the day's end. */
function parseRange(range: string): { from: number; to: number } | null {
  const match = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(range.trim());
  if (!match) return null;
  const from = Number(match[1]) * 60 + Number(match[2]);
  const raw = Number(match[3]) * 60 + Number(match[4]);
  const to = raw === 0 ? 24 * 60 : raw;
  return to > from ? { from, to } : null;
}

/**
 * Reads the schedule in the zone it is published in.
 *
 * Capital quotes these in UTC today, but the field names its own zone, so that
 * is what is honoured rather than an assumption that would silently shift every
 * session by hours if it ever changed.
 */
function minutesInZone(at: number, zone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(at));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hour = Number(get('hour')) % 24;

  return { day: day < 0 ? new Date(at).getUTCDay() : day, minute: hour * 60 + Number(get('minute')) };
}

/** Start of the local day containing `at`, as an epoch instant. */
function startOfDay(at: number, zone: string): number {
  const { minute } = minutesInZone(at, zone);
  return at - minute * 60_000 - (at % 60_000);
}

export function marketHours(hours: OpeningHours | undefined, now: number): MarketHours | null {
  if (!hours) return null;
  const zone = hours.zone ?? 'UTC';

  let dayStart = startOfDay(now, zone);
  let open = false;
  let closesAt: number | null = null;
  let opensAt: number | null = null;

  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const { day } = minutesInZone(dayStart + 12 * 60 * 60_000, zone);
    const ranges = (hours[DAYS[day]] ?? []).map(parseRange).filter((range) => range !== null);

    for (const range of ranges) {
      const from = dayStart + range.from * 60_000;
      const to = dayStart + range.to * 60_000;
      if (offset === 0 && now >= from && now < to) {
        open = true;
        closesAt = to;
      }
      if (!open && opensAt === null && from > now) opensAt = from;
    }

    if (open || opensAt !== null) break;
    // Re-derived rather than advanced by a fixed day, so a clock change does
    // not walk every later session an hour off.
    dayStart = startOfDay(dayStart + DAY_MS + 3 * 3_600_000, zone);
  }

  return { open, closesAt, opensAt };
}
