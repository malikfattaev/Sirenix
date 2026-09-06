import { capital } from '@/lib/capital/client';
import {
  CANDLE_DEPTH,
  TIMEFRAME_MS,
  TIMEFRAME_ROLES,
  type InstrumentConfig,
  type TimeframeRole,
} from '@/lib/config';
import { toCandles, type Candle } from '@/lib/market/candles';

export type CandlesByRole = Record<TimeframeRole, Candle[]>;

interface Entry {
  candles: CandlesByRole;
  /** When the next one-minute candle is expected to be available upstream. */
  staleAt: number;
}

/** Grace period after a candle closes before the API is expected to serve it. */
const PUBLISH_DELAY_MS = 2_000;

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CandlesByRole>>();

/**
 * Candles for every timeframe, refetched only once a new one-minute bar exists.
 *
 * The strategy reads closed candles, so its inputs cannot change more often
 * than once a minute. Caching them is what makes it cheap to re-run the whole
 * analysis every second against a fresh price.
 */
export function getCandles(instrument: InstrumentConfig): Promise<CandlesByRole> {
  const cached = cache.get(instrument.id);
  if (cached && Date.now() < cached.staleAt) return Promise.resolve(cached.candles);

  const pending = inFlight.get(instrument.id);
  if (pending) return pending;

  const request = fetchCandles(instrument)
    .then((candles) => {
      const newest = candles.entry[candles.entry.length - 1];
      const staleAt = newest
        ? newest.closeTime + TIMEFRAME_MS.MINUTE + PUBLISH_DELAY_MS
        : Date.now() + TIMEFRAME_MS.MINUTE;
      cache.set(instrument.id, { candles, staleAt });
      return candles;
    })
    .finally(() => {
      inFlight.delete(instrument.id);
    });

  inFlight.set(instrument.id, request);
  return request;
}

async function fetchCandles(instrument: InstrumentConfig): Promise<CandlesByRole> {
  const raw = await capital.getCandlesForRoles(instrument.epic, TIMEFRAME_ROLES, CANDLE_DEPTH);
  const now = Date.now();
  return Object.fromEntries(
    (Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]).map((role) => [
      role,
      toCandles(raw[role], TIMEFRAME_ROLES[role], now),
    ]),
  ) as CandlesByRole;
}
