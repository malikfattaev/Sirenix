import { SESSION } from '@/lib/config';
import { minutesIntoSession } from '@/lib/market/session';
import { clamp, entryConfirmation, sign } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/** The opening range only stays meaningful for the first few hours. */
const MAX_MINUTES_INTO_SESSION = 300;

/**
 * Trade the break of the session's opening range.
 *
 * The first {@link SESSION.openingRangeMinutes} minutes define the day's
 * reference band; a clean break of it, ideally after a retest, is one of the
 * more reliable intraday setups.
 */
export const openingRange: Strategy = {
  key: 'opening-range',
  label: 'Пробой открытия',
  bias: 'continuation',
  regimes: ['BREAKOUT', 'TREND'],

  evaluate(context): StrategyCandidate | null {
    const range = context.session.openingRange;
    if (!range) return null;

    const elapsed = minutesIntoSession(context.now);
    if (elapsed <= SESSION.openingRangeMinutes || elapsed > MAX_MINUTES_INTO_SESSION) return null;

    const { setup, entry } = context.views;
    const brokeUp = context.price > range.high;
    const brokeDown = context.price < range.low;
    if (!brokeUp && !brokeDown) return null;

    const side = brokeUp ? 'LONG' : 'SHORT';
    const s = sign(side);
    const level = brokeUp ? range.high : range.low;
    const travelled = (s * (context.price - level)) / setup.atr;
    if (travelled > 2.0) return null;

    const confirmation = entryConfirmation(entry, side);
    if (confirmation < 0.4) return null;

    return {
      strategy: 'opening-range',
      direction: side,
      invalidation: level - s * 0.6 * setup.atr,
      triggerPrice: level,
      quality: clamp(0.45 * confirmation + 0.35 * (1 - travelled / 2) + 0.2, 0, 1),
      reasons: [
        `Session opening range broken to the ${brokeUp ? 'upside' : 'downside'}`,
        `Price still within ${travelled.toFixed(1)} ATR of the breakout level`,
        `1m confirms the break`,
      ],
    };
  },
};
