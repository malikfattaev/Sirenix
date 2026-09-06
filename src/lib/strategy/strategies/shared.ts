import { REGIME } from '@/lib/config';
import { rangeOf, type Level } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import type { Direction, MarketContext, TimeframeView } from '../types';

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** +1 for a long, -1 for a short, so mirrored logic can be written once. */
export const sign = (direction: Direction): number => (direction === 'LONG' ? 1 : -1);

/**
 * Trapezoid membership: 1 across the plateau, falling linearly to 0 at the
 * outer edges. Scores "is this value in a good range?" without hard cliffs.
 */
export function plateau(
  value: number,
  zeroLow: number,
  fullLow: number,
  fullHigh: number,
  zeroHigh: number,
): number {
  if (value <= zeroLow || value >= zeroHigh) return 0;
  if (value < fullLow) return (value - zeroLow) / (fullLow - zeroLow);
  if (value > fullHigh) return (zeroHigh - value) / (zeroHigh - fullHigh);
  return 1;
}

/** Directional read of a timeframe from its EMA 9/20/50 stack, scaled by ATR. */
export function trendVote(view: TimeframeView): number {
  const fast = clamp((view.ema9 - view.ema20) / (0.5 * view.atr), -1, 1);
  const price = clamp((view.close - view.ema20) / (1.2 * view.atr), -1, 1);
  if (view.ema50 === null) return 0.65 * fast + 0.35 * price;
  const slow = clamp((view.ema20 - view.ema50) / (1.0 * view.atr), -1, 1);
  return 0.45 * fast + 0.3 * slow + 0.25 * price;
}

/** Nearest level on one side of the price. */
export function nearestLevel(
  levels: Level[],
  price: number,
  side: 'support' | 'resistance',
): Level | undefined {
  const candidates = levels.filter((level) =>
    side === 'support' ? level.kind === 'support' && level.price <= price : level.kind === 'resistance' && level.price >= price,
  );
  return candidates.reduce<Level | undefined>(
    (closest, level) =>
      !closest || Math.abs(level.price - price) < Math.abs(closest.price - price) ? level : closest,
    undefined,
  );
}

/**
 * How convincingly the 1-minute chart confirms the direction right now.
 * This is the last gate before an entry: structure and setup can be perfect,
 * but without a 1m confirmation the entry is a guess.
 */
export function entryConfirmation(entry: TimeframeView, direction: Direction): number {
  const candles = entry.candles;
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  if (!last || !previous) return 0;

  const s = sign(direction);
  const body = clamp((s * (last.close - last.open)) / (0.6 * entry.atr), 0, 1);
  const closeVsEma = clamp((s * (last.close - entry.ema9)) / (0.5 * entry.atr), 0, 1);

  // A rejection wick on the far side means the other side tried and failed.
  const range = last.high - last.low;
  const wick =
    range <= 0
      ? 0
      : direction === 'LONG'
        ? (Math.min(last.open, last.close) - last.low) / range
        : (last.high - Math.max(last.open, last.close)) / range;
  const rejection = clamp(wick / 0.45, 0, 1);
  const follow = s * (last.close - previous.close) > 0 ? 1 : 0;

  return clamp(0.35 * body + 0.25 * closeVsEma + 0.25 * rejection + 0.15 * follow, 0, 1);
}

/** True when a recent candle traded into the level and closed back away from it. */
export function rejectedLevel(
  view: TimeframeView,
  level: number,
  direction: Direction,
  bars = 4,
): boolean {
  const tolerance = view.atr * 0.7;
  return view.candles.slice(-bars).some((candle) =>
    direction === 'LONG'
      ? candle.low <= level + tolerance && candle.close > level
      : candle.high >= level - tolerance && candle.close < level,
  );
}

/** Most recent confirmed swing on one side, used as the invalidation level. */
export function lastSwing(view: TimeframeView, kind: 'high' | 'low'): number | undefined {
  const pivots = kind === 'high' ? view.swingHighs : view.swingLows;
  return pivots[pivots.length - 1]?.price;
}

/** Extreme of the last `bars` candles, ignoring the current one. */
export function recentExtreme(candles: Candle[], bars: number, kind: 'high' | 'low'): number {
  const window = candles.slice(-bars - 1, -1);
  if (window.length === 0) return kind === 'high' ? -Infinity : Infinity;
  return kind === 'high'
    ? Math.max(...window.map((candle) => candle.high))
    : Math.min(...window.map((candle) => candle.low));
}

/** Local 5m range used by the breakout and mean-reversion setups. */
export const localRange = (context: MarketContext) =>
  rangeOf(context.views.setup.candles, REGIME.rangeLookback);
