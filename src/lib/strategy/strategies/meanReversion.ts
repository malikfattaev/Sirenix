import { clamp, entryConfirmation, localRange, plateau, rejectedLevel, sign } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/**
 * Fade the edges of a quiet intraday range back toward its middle.
 *
 * Only allowed while the market is genuinely ranging — the moment a breakout
 * regime is detected this strategy is switched off entirely.
 */
export const meanReversion: Strategy = {
  key: 'mean-reversion',
  label: 'Range Mean Reversion',
  bias: 'reversion',
  regimes: ['RANGE'],

  evaluate(context): StrategyCandidate | null {
    const { setup, entry } = context.views;
    const range = localRange(context);
    const height = range.high - range.low;
    if (height < setup.atr * 1.5) return null;

    const fromLow = (context.price - range.low) / height;
    const side = fromLow <= 0.3 ? 'LONG' : fromLow >= 0.7 ? 'SHORT' : null;
    if (!side) return null;

    const s = sign(side);
    const edge = side === 'LONG' ? range.low : range.high;
    const proximity = plateau(Math.abs(context.price - edge) / setup.atr, -0.1, 0, 0.9, 2.0);
    if (proximity <= 0) return null;

    if (!rejectedLevel(entry, edge, side, 5)) return null;
    const confirmation = entryConfirmation(entry, side);
    if (confirmation < 0.45) return null;

    // Aim for whichever of VWAP and the range middle comes first.
    const middle = (range.high + range.low) / 2;
    const ahead = [middle, context.vwap]
      .filter((value): value is number => value !== null)
      .filter((value) => s * (value - context.price) > 0);
    const target = ahead.length > 0 ? ahead.reduce((a, b) => (s * (a - b) < 0 ? a : b)) : middle;

    return {
      strategy: 'mean-reversion',
      direction: side,
      invalidation: edge - s * 0.6 * setup.atr,
      triggerPrice: edge,
      preferredTarget: target,
      quality: clamp(0.4 * proximity + 0.35 * confirmation + 0.25 * clamp(height / (setup.atr * 4), 0, 1), 0, 1),
      reasons: [
        `Market is ranging over ${(height / setup.atr).toFixed(1)} ATR`,
        `Price reached the range ${side === 'LONG' ? 'low' : 'high'} and was rejected`,
        `Target back toward the middle of the range`,
      ],
    };
  },
};
