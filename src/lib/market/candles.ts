import { parseUtc } from '@/lib/capital/client';
import type { CapitalPrice, CapitalPricePoint } from '@/lib/capital/types';
import { TIMEFRAME_MS, type Timeframe } from '@/lib/config';

/**
 * A normalised OHLC candle. Prices are mid quotes — the average of bid and ask —
 * so indicators are not skewed by the spread, which is tracked separately.
 */
export interface Candle {
  /** Candle open time, epoch milliseconds. */
  time: number;
  /** Candle close time, epoch milliseconds. */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Ask minus bid at the candle close. */
  spread: number;
}

const mid = (point: CapitalPricePoint): number => (point.bid + point.ask) / 2;

/**
 * Converts raw API prices into candles, keeping only candles that have already
 * closed at `asOf`. The in-progress candle is always excluded: acting on it
 * would mean reacting to a bar that can still change shape.
 */
export function toCandles(
  prices: CapitalPrice[],
  timeframe: Timeframe,
  asOf: number = Date.now(),
): Candle[] {
  const duration = TIMEFRAME_MS[timeframe];

  return prices
    .map((price) => {
      const time = parseUtc(price.snapshotTimeUTC).getTime();
      return {
        time,
        closeTime: time + duration,
        open: mid(price.openPrice),
        high: mid(price.highPrice),
        low: mid(price.lowPrice),
        close: mid(price.closePrice),
        volume: price.lastTradedVolume,
        spread: price.closePrice.ask - price.closePrice.bid,
      };
    })
    .filter((candle) => Number.isFinite(candle.close) && candle.closeTime <= asOf)
    .sort((a, b) => a.time - b.time);
}

/** Every candle that had already closed at `asOf` — the no-lookahead slice. */
export function closedBefore(candles: Candle[], asOf: number): Candle[] {
  const end = upperBound(candles, asOf);
  return end === candles.length ? candles : candles.slice(0, end);
}

/** Index of the first candle closing after `asOf` (binary search). */
function upperBound(candles: Candle[], asOf: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].closeTime <= asOf) low = middle + 1;
    else high = middle;
  }
  return low;
}
