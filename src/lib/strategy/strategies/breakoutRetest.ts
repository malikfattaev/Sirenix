import { REGIME } from '@/lib/config';
import { rangeOf } from '@/lib/indicators';
import { clamp, entryConfirmation, sign } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/** Bars after the break within which a retest still counts as fresh. */
const RETEST_WINDOW = 10;

/**
 * Break a level, come back to it, and only then trade it.
 *
 * Waiting for the retest is the whole point: it filters out the false breaks
 * that would otherwise be entered at the worst possible price.
 */
export const breakoutRetest: Strategy = {
  key: 'breakout-retest',
  label: 'Breakout + Retest',
  bias: 'continuation',
  regimes: ['BREAKOUT', 'TREND'],

  evaluate(context): StrategyCandidate | null {
    const { setup, entry } = context.views;
    const candles = setup.candles;

    // The range as it stood before the break, measured back from each candidate bar.
    for (let barsAgo = 1; barsAgo <= RETEST_WINDOW; barsAgo += 1) {
      const breakIndex = candles.length - 1 - barsAgo;
      if (breakIndex <= REGIME.rangeLookback) continue;

      const before = rangeOf(candles.slice(0, breakIndex), REGIME.rangeLookback);
      const breakCandle = candles[breakIndex];
      const brokeUp = breakCandle.close > before.high;
      const brokeDown = breakCandle.close < before.low;
      if (!brokeUp && !brokeDown) continue;

      const side = brokeUp ? 'LONG' : 'SHORT';
      const s = sign(side);
      const level = brokeUp ? before.high : before.low;

      // Price must have returned to the level without giving it back.
      const since = candles.slice(breakIndex + 1);
      const retestDistance = Math.abs(context.price - level) / setup.atr;
      const held = since.every((candle) => s * (candle.close - level) > -0.35 * setup.atr);
      if (!held || retestDistance > 1.1) continue;

      const confirmation = entryConfirmation(entry, side);
      if (confirmation < 0.4) continue;

      return {
        strategy: 'breakout-retest',
        direction: side,
        invalidation: level - s * 0.6 * setup.atr,
        triggerPrice: level,
        quality: clamp(
          0.4 * confirmation + 0.35 * (1 - retestDistance / 1.1) + 0.25 * Math.min(barsAgo / 4, 1),
          0,
          1,
        ),
        reasons: [
          `5m ${brokeUp ? 'resistance' : 'support'} broken ${barsAgo} bars ago`,
          `Price retested the level and it held`,
          `1m confirms the continuation`,
        ],
      };
    }
    return null;
  },
};
