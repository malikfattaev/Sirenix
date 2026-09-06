import { clamp, entryConfirmation, nearestLevel, plateau, rejectedLevel, sign } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/**
 * Fade a reaction at a level that has already proved itself.
 *
 * Arriving at the level is not the signal — the 1m rejection is. Levels are
 * taken from both the 5m and 15m frames and weighted by how often they held.
 */
export const srBounce: Strategy = {
  key: 'sr-bounce',
  label: 'S/R Bounce',
  bias: 'reversion',
  regimes: ['RANGE', 'TREND', 'CHOP'],

  evaluate(context): StrategyCandidate | null {
    const { setup, direction: higher, entry } = context.views;
    const levels = [...setup.levels, ...higher.levels];

    const support = nearestLevel(levels, context.price, 'support');
    const resistance = nearestLevel(levels, context.price, 'resistance');

    const options = [
      support ? { side: 'LONG' as const, level: support } : null,
      resistance ? { side: 'SHORT' as const, level: resistance } : null,
    ].filter((option) => option !== null);
    if (options.length === 0) return null;

    // Whichever level price is actually standing on.
    const chosen = options.reduce((best, option) =>
      Math.abs(option.level.price - context.price) < Math.abs(best.level.price - context.price)
        ? option
        : best,
    );

    const s = sign(chosen.side);
    const distance = (s * (context.price - chosen.level.price)) / setup.atr;
    const proximity = plateau(distance, -0.6, -0.1, 0.8, 1.8);
    if (proximity <= 0 || chosen.level.strength < 0.35) return null;

    if (!rejectedLevel(entry, chosen.level.price, chosen.side, 5)) return null;
    const confirmation = entryConfirmation(entry, chosen.side);
    if (confirmation < 0.45) return null;

    return {
      strategy: 'sr-bounce',
      direction: chosen.side,
      invalidation: chosen.level.price - s * 0.7 * setup.atr,
      triggerPrice: chosen.level.price,
      quality: clamp(0.35 * proximity + 0.35 * confirmation + 0.3 * chosen.level.strength, 0, 1),
      reasons: [
        `${chosen.side === 'LONG' ? 'Support' : 'Resistance'} with ${chosen.level.touches} prior reactions`,
        `Price reached the level and was rejected`,
        `1m confirms the turn`,
      ],
    };
  },
};
