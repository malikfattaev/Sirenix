import { clamp, entryConfirmation, lastSwing, plateau, sign, trendVote } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/**
 * Trade the pullback through the mean instead of the bounce off it.
 *
 * Measurement on GOLD and BRENT showed that price reaching the 5m EMA band in
 * an established trend keeps going *past* it far more often than it resumes,
 * so this setup takes the pullback's own direction rather than fading it. The
 * trend still has to exist: without one there is no pullback to trade.
 */
export const pullbackFade: Strategy = {
  key: 'pullback-fade',
  label: 'Продолжение после отката',
  bias: 'reversion',
  regimes: ['TREND', 'BREAKOUT', 'RANGE'],

  evaluate(context): StrategyCandidate | null {
    const { direction: higher, setup, entry } = context.views;
    const directionVote = trendVote(higher);
    const setupVote = trendVote(setup);
    if (Math.sign(directionVote) !== Math.sign(setupVote)) return null;
    if (Math.abs(setupVote) < 0.25) return null;

    // The trend points one way; the pullback, and this trade, point the other.
    const trend = setupVote > 0 ? 1 : -1;
    const side = trend > 0 ? 'SHORT' : 'LONG';
    const s = sign(side);

    // Price must actually be at the mean, not still extended in the trend.
    const extension = (trend * (context.price - setup.ema20)) / setup.atr;
    const depth = plateau(extension, -1.8, -0.6, 0.7, 1.3);
    if (depth <= 0) return null;

    const confirmation = entryConfirmation(entry, side);
    if (confirmation < 0.35) return null;

    // Invalidated if the trend resumes: the swing left behind by the pullback.
    const swing = lastSwing(setup, side === 'LONG' ? 'low' : 'high');
    const invalidation =
      swing !== undefined && s * (context.price - swing) > 0
        ? swing
        : context.price - s * 1.2 * setup.atr;

    return {
      strategy: 'pullback-fade',
      direction: side,
      invalidation,
      triggerPrice: setup.ema20,
      quality: clamp(0.45 * depth + 0.35 * confirmation + 0.2 * Math.abs(setupVote), 0, 1),
      reasons: [
        `15m and 5m trend ${trend > 0 ? 'up' : 'down'}, price pulled back to the 5m EMA band`,
        `Pullback still has momentum rather than turning`,
        `1m confirms continuation ${side === 'LONG' ? 'lower' : 'higher'}`,
      ],
    };
  },
};
