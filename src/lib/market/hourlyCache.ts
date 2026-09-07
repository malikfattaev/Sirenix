import { capital } from '@/lib/capital/client';
import { SWING, TIMEFRAME_MS, type InstrumentConfig } from '@/lib/config';
import { toCandles, type Candle } from '@/lib/market/candles';

interface Entry {
  candles: Candle[];
  /** When the next hourly candle is expected to be available upstream. */
  staleAt: number;
}

/** Grace period after a candle closes before the API is expected to serve it. */
const PUBLISH_DELAY_MS = 5_000;

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Candle[]>>();

/**
 * Hourly candles, refetched only once a new bar exists.
 *
 * The daily signal reads closed hourly candles, so its inputs change once an
 * hour. Caching them keeps a sixteen-instrument board cheap enough to recompute
 * on every poll against a live price.
 */
export function getHourlyCandles(instrument: InstrumentConfig): Promise<Candle[]> {
  const cached = cache.get(instrument.id);
  if (cached && Date.now() < cached.staleAt) return Promise.resolve(cached.candles);

  const pending = inFlight.get(instrument.id);
  if (pending) return pending;

  const request = capital
    .getCandles(instrument.epic, 'HOUR', SWING.candleDepth)
    .then((raw) => {
      const candles = toCandles(raw, 'HOUR');
      const newest = candles[candles.length - 1];
      cache.set(instrument.id, {
        candles,
        staleAt: newest
          ? newest.closeTime + TIMEFRAME_MS.HOUR + PUBLISH_DELAY_MS
          : Date.now() + TIMEFRAME_MS.HOUR,
      });
      return candles;
    })
    .finally(() => {
      inFlight.delete(instrument.id);
    });

  inFlight.set(instrument.id, request);
  return request;
}
