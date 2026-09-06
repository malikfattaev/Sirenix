import { clamp, entryConfirmation, recentExtreme, sign, trendVote } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/** How many 1m candles must lean the same way for the burst to count. */
const BURST_BARS = 3;

/**
 * Catch a sharp impulse early.
 *
 * Requires expanding volatility, a fresh local break and 1m candles pushing in
 * the same direction — and refuses the trade once price has already travelled
 * too far from the break, which is where momentum entries usually go wrong.
 */
export const momentum: Strategy = {
  key: 'momentum',
  label: 'Momentum',
  bias: 'continuation',
  regimes: ['BREAKOUT', 'TREND', 'EXTREME_VOLATILITY'],

  evaluate(context): StrategyCandidate | null {
    const { setup, entry } = context.views;
    if (entry.atrRatio < 1.15) return null;

    const recent = entry.candles.slice(-BURST_BARS);
    const bullish = recent.filter((candle) => candle.close > candle.open).length;
    const side = bullish >= BURST_BARS - 1 ? 'LONG' : bullish <= 1 ? 'SHORT' : null;
    if (!side) return null;

    const s = sign(side);
    if (s * trendVote(setup) < 0) return null;
    if (context.vwap !== null && s * (context.price - context.vwap) < 0) return null;

    // The impulse must have taken out a local extreme on the 5m chart.
    const level = recentExtreme(setup.candles, 12, side === 'LONG' ? 'high' : 'low');
    if (!Number.isFinite(level) || s * (context.price - level) <= 0) return null;

    const travelled = (s * (context.price - level)) / entry.atr;
    const separation = setup.ema50 === null ? 0 : Math.abs(setup.ema9 - setup.ema20) / setup.atr;
    const confirmation = entryConfirmation(entry, side);

    return {
      strategy: 'momentum',
      direction: side,
      invalidation: level - s * 0.5 * entry.atr,
      triggerPrice: level,
      quality: clamp(
        0.35 * confirmation + 0.3 * clamp(entry.atrRatio - 1, 0, 1) + 0.2 * clamp(separation, 0, 1) + 0.15 * (1 - clamp(travelled / 3, 0, 1)),
        0,
        1,
      ),
      reasons: [
        `${BURST_BARS} strong 1m candles ${side === 'LONG' ? 'up' : 'down'}`,
        `Broke the local 5m ${side === 'LONG' ? 'high' : 'low'} with ATR expanding ${entry.atrRatio.toFixed(1)}x`,
        `Price on the ${side === 'LONG' ? 'buy' : 'sell'} side of VWAP`,
      ],
    };
  },
};
