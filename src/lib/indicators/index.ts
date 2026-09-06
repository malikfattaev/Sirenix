import type { Candle } from '@/lib/market/candles';

/** Indicator series are aligned with the input; `null` means "not enough data yet". */
export type Series = (number | null)[];

export const last = <T,>(values: T[]): T | undefined => values[values.length - 1];

/** Most recent non-null value of a series. */
export function lastValue(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null) return series[i];
  }
  return null;
}

/** Value `offset` bars back from the end, or null when out of range. */
export function valueAt(series: Series, offset: number): number | null {
  return series[series.length - 1 - offset] ?? null;
}

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with the simple average of the first window. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const multiplier = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] - previous) * multiplier + previous;
    out[i] = previous;
  }
  return out;
}

/** Wilder's Relative Strength Index. */
export function rsi(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: number[], fast: number, slow: number, signalPeriod: number): MacdResult {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);

  const macdLine: Series = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });

  // The signal EMA is computed over the defined part of the MACD line only,
  // then mapped back onto the original indices.
  const firstDefined = macdLine.findIndex((value) => value !== null);
  const signal: Series = new Array(values.length).fill(null);
  const histogram: Series = new Array(values.length).fill(null);

  if (firstDefined !== -1) {
    const dense = macdLine.slice(firstDefined) as number[];
    const denseSignal = ema(dense, signalPeriod);
    for (let i = 0; i < denseSignal.length; i += 1) {
      const value = denseSignal[i];
      if (value === null) continue;
      const index = firstDefined + i;
      signal[index] = value;
      histogram[index] = dense[i] - value;
    }
  }

  return { macd: macdLine, signal, histogram };
}

/** Wilder's Average True Range. */
export function atr(candles: Candle[], period: number): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const trueRanges: number[] = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const { high, low } = candles[i];
    const previousClose = candles[i - 1].close;
    trueRanges.push(
      Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)),
    );
  }

  let value = trueRanges.slice(1, period + 1).reduce((sum, tr) => sum + tr, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i += 1) {
    value = (value * (period - 1) + trueRanges[i]) / period;
    out[i] = value;
  }
  return out;
}

export interface Pivot {
  index: number;
  time: number;
  price: number;
  kind: 'high' | 'low';
}

/**
 * Confirmed swing points: a pivot needs `lookback` candles on *both* sides, so
 * the newest `lookback` candles can never produce one. That delay is what makes
 * the detection safe to use in a walk-forward backtest.
 */
export function findPivots(candles: Candle[], lookback: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let offset = 1; offset <= lookback; offset += 1) {
      if (candles[i].high <= candles[i - offset].high || candles[i].high < candles[i + offset].high) {
        isHigh = false;
      }
      if (candles[i].low >= candles[i - offset].low || candles[i].low > candles[i + offset].low) {
        isLow = false;
      }
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ index: i, time: candles[i].time, price: candles[i].high, kind: 'high' });
    if (isLow) pivots.push({ index: i, time: candles[i].time, price: candles[i].low, kind: 'low' });
  }
  return pivots;
}

export interface Level {
  price: number;
  kind: 'support' | 'resistance';
  /** How many pivots formed this level. */
  touches: number;
  /** 0-1 blend of touch count and recency; higher means more relevant. */
  strength: number;
  lastTouchIndex: number;
}

/**
 * Groups nearby pivots into horizontal levels. Pivots within `tolerance` of an
 * existing cluster reinforce it instead of creating a new one, which is what
 * turns a scatter of highs and lows into a handful of tradable levels.
 */
export function buildLevels(pivots: Pivot[], tolerance: number, totalCandles: number): Level[] {
  if (tolerance <= 0 || pivots.length === 0) return [];

  interface Cluster {
    prices: number[];
    kind: 'high' | 'low';
    lastTouchIndex: number;
  }

  const clusters: Cluster[] = [];
  for (const pivot of [...pivots].sort((a, b) => a.price - b.price)) {
    const open = clusters.find(
      (cluster) => cluster.kind === pivot.kind && Math.abs(average(cluster.prices) - pivot.price) <= tolerance,
    );
    if (open) {
      open.prices.push(pivot.price);
      open.lastTouchIndex = Math.max(open.lastTouchIndex, pivot.index);
    } else {
      clusters.push({ prices: [pivot.price], kind: pivot.kind, lastTouchIndex: pivot.index });
    }
  }

  const maxTouches = Math.max(...clusters.map((cluster) => cluster.prices.length));
  return clusters
    .map((cluster) => {
      const recency = totalCandles > 1 ? cluster.lastTouchIndex / (totalCandles - 1) : 1;
      const density = cluster.prices.length / maxTouches;
      return {
        price: average(cluster.prices),
        kind: cluster.kind === 'high' ? ('resistance' as const) : ('support' as const),
        touches: cluster.prices.length,
        strength: 0.6 * density + 0.4 * recency,
        lastTouchIndex: cluster.lastTouchIndex,
      };
    })
    .sort((a, b) => a.price - b.price);
}

export const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Linear regression slope of the last `period` values, normalised by price. */
export function slope(values: number[], period: number): number | null {
  if (values.length < period || period < 2) return null;
  const window = values.slice(-period);
  const meanX = (period - 1) / 2;
  const meanY = average(window);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < period; i += 1) {
    numerator += (i - meanX) * (window[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  if (denominator === 0 || meanY === 0) return null;
  return numerator / denominator / meanY;
}

/**
 * Session-anchored VWAP: the volume-weighted average price since the last
 * session rollover. It is the intraday reference every scalping setup is
 * measured against, so it resets with the trading day rather than rolling.
 *
 * Falls back to an equal-weighted average when the feed reports no volume.
 */
export function sessionVwap(candles: Candle[], sessionStart: number): number | null {
  let volumePrice = 0;
  let volume = 0;
  let sumTypical = 0;
  let count = 0;

  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const candle = candles[i];
    if (candle.time < sessionStart) break;
    const typical = (candle.high + candle.low + candle.close) / 3;
    volumePrice += typical * candle.volume;
    volume += candle.volume;
    sumTypical += typical;
    count += 1;
  }

  if (count === 0) return null;
  return volume > 0 ? volumePrice / volume : sumTypical / count;
}

/** Highest high and lowest low over the last `lookback` candles. */
export function rangeOf(candles: Candle[], lookback: number): { high: number; low: number } {
  const window = candles.slice(-lookback);
  return {
    high: Math.max(...window.map((candle) => candle.high)),
    low: Math.min(...window.map((candle) => candle.low)),
  };
}

/** Median of a numeric series, used for a volatility baseline that ignores spikes. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
