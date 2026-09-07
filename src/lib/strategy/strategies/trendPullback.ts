import { clamp, entryConfirmation, lastSwing, plateau, sign, trendVote } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/**
 * Buy the dip inside an established trend.
 *
 * The 15m and 5m frames must agree on direction and price must have come back
 * to the EMA 9/20 band (or VWAP) rather than run away from it — then the 1m
 * chart has to show the move resuming before anything is signalled.
 */
export const trendPullback: Strategy = {
  key: 'trend-pullback',
  label: 'Откат по тренду',
  bias: 'continuation',
  regimes: ['TREND', 'BREAKOUT'],

  evaluate(context): StrategyCandidate | null {
    const { direction: higher, setup, entry } = context.views;
    const directionVote = trendVote(higher);
    const setupVote = trendVote(setup);
    if (Math.sign(directionVote) !== Math.sign(setupVote)) return null;
    if (Math.abs(setupVote) < 0.25) return null;

    const side = setupVote > 0 ? 'LONG' : 'SHORT';
    const s = sign(side);
    if (higher.structure !== 'range' && higher.structure !== (side === 'LONG' ? 'up' : 'down')) {
      return null;
    }

    // The pullback target is whichever reference price came back to first.
    const references = [setup.ema9, setup.ema20, context.vwap].filter(
      (value): value is number => value !== null,
    );
    const distances = references.map((reference) => (s * (context.price - reference)) / setup.atr);
    const closest = Math.min(...distances.map(Math.abs));
    const nearestReference = references[distances.map(Math.abs).indexOf(closest)];

    // Too far above the band means the move already happened; below it, the trend broke.
    const extension = (s * (context.price - setup.ema20)) / setup.atr;
    if (extension > 1.3) return null;
    const depth = plateau(extension, -1.8, -0.6, 0.7, 1.3);
    if (depth <= 0) return null;

    const confirmation = entryConfirmation(entry, side);
    if (confirmation < 0.35) return null;

    const swing = lastSwing(setup, side === 'LONG' ? 'low' : 'high');
    const invalidation =
      swing !== undefined && s * (context.price - swing) > 0
        ? swing
        : context.price - s * 1.2 * setup.atr;

    return {
      strategy: 'trend-pullback',
      direction: side,
      invalidation,
      triggerPrice: nearestReference,
      quality: clamp(0.45 * depth + 0.3 * confirmation + 0.25 * Math.abs(setupVote), 0, 1),
      reasons: [
        `15m and 5m both ${side === 'LONG' ? 'bullish' : 'bearish'}`,
        `Pullback into the 5m EMA9/20 band (${closest.toFixed(1)} ATR away)`,
        `1m confirms the move resuming`,
      ],
    };
  },
};
