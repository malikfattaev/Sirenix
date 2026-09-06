import { clamp, entryConfirmation, plateau, rejectedLevel, sign, trendVote } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/**
 * Trade the return to the intraday volume-weighted average price.
 *
 * VWAP is never used on its own: the 5m trend must already point our way and
 * the 1m chart must reject the level before the setup is valid.
 */
export const vwapPullback: Strategy = {
  key: 'vwap-pullback',
  label: 'VWAP Pullback',
  regimes: ['TREND', 'RANGE', 'BREAKOUT'],

  evaluate(context): StrategyCandidate | null {
    const { vwap } = context;
    if (vwap === null) return null;

    const { setup, entry } = context.views;
    const setupVote = trendVote(setup);
    if (Math.abs(setupVote) < 0.2) return null;

    const side = setupVote > 0 ? 'LONG' : 'SHORT';
    const s = sign(side);
    // Price must sit on the trend side of VWAP and be pulling back toward it.
    const distance = (s * (context.price - vwap)) / setup.atr;
    const proximity = plateau(distance, -0.5, 0, 0.9, 2.0);
    if (proximity <= 0) return null;

    if (!rejectedLevel(entry, vwap, side, 6)) return null;
    const confirmation = entryConfirmation(entry, side);
    if (confirmation < 0.4) return null;

    return {
      strategy: 'vwap-pullback',
      direction: side,
      invalidation: vwap - s * 0.7 * setup.atr,
      triggerPrice: vwap,
      quality: clamp(0.4 * proximity + 0.35 * confirmation + 0.25 * Math.abs(setupVote), 0, 1),
      reasons: [
        `5m trend ${side === 'LONG' ? 'bullish' : 'bearish'}, price on the ${side === 'LONG' ? 'upper' : 'lower'} side of VWAP`,
        `Pullback to VWAP held (${distance.toFixed(1)} ATR away)`,
        `1m ${side === 'LONG' ? 'bullish' : 'bearish'} rejection off the level`,
      ],
    };
  },
};
