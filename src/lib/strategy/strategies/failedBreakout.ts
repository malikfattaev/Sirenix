import { clamp, entryConfirmation, recentExtreme, sign } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/** How many recent 5m bars are searched for the sweep. */
const SWEEP_WINDOW = 6;

/**
 * Trade against a break that could not hold — the liquidity sweep.
 *
 * Price pokes through an obvious high or low, fails to stay there and closes
 * back inside. The failure itself is the signal, and the swept extreme becomes
 * the invalidation level.
 */
export const failedBreakout: Strategy = {
  key: 'failed-breakout',
  label: 'Failed Breakout',
  regimes: ['RANGE', 'CHOP', 'TREND', 'EXTREME_VOLATILITY'],

  evaluate(context): StrategyCandidate | null {
    const { setup, entry } = context.views;
    const candles = setup.candles;

    for (let barsAgo = 1; barsAgo <= SWEEP_WINDOW; barsAgo += 1) {
      const index = candles.length - barsAgo;
      const candle = candles[index];
      if (!candle) continue;

      const priorHigh = recentExtreme(candles.slice(0, index + 1), 20, 'high');
      const priorLow = recentExtreme(candles.slice(0, index + 1), 20, 'low');

      const sweptHigh = candle.high > priorHigh && candle.close < priorHigh;
      const sweptLow = candle.low < priorLow && candle.close > priorLow;
      if (!sweptHigh && !sweptLow) continue;

      const side = sweptHigh ? 'SHORT' : 'LONG';
      const s = sign(side);
      const level = sweptHigh ? priorHigh : priorLow;
      const extreme = sweptHigh ? candle.high : candle.low;

      // Price must still be on the correct side of the swept level.
      if (s * (context.price - level) > 0.4 * setup.atr) continue;

      const confirmation = entryConfirmation(entry, side);
      if (confirmation < 0.45) continue;

      return {
        strategy: 'failed-breakout',
        direction: side,
        invalidation: extreme + s * -0.3 * setup.atr,
        triggerPrice: level,
        quality: clamp(0.5 * confirmation + 0.3 * (1 - barsAgo / SWEEP_WINDOW) + 0.2, 0, 1),
        reasons: [
          `Price swept the prior 5m ${sweptHigh ? 'high' : 'low'} and closed back inside`,
          `The break could not hold — likely a liquidity grab`,
          `1m momentum turning ${side === 'LONG' ? 'up' : 'down'}`,
        ],
      };
    }
    return null;
  },
};
