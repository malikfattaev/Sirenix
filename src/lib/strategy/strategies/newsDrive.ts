import { NEWS } from '@/lib/config';
import { clamp, entryConfirmation, recentExtreme, sign, trendVote } from './shared';
import type { Strategy, StrategyCandidate } from '../types';

/** 1m candles inspected for the move the headlines are supposed to explain. */
const IMPULSE_BARS = 5;

/**
 * Trade a story the tape already agrees with.
 *
 * Headlines on their own are a terrible entry signal: by the time a wire prints
 * "oil surges", the surge has happened. So this asks for three things at once —
 * coverage that is running hot, a clear directional lean across those
 * headlines, and price on the 1m chart moving the same way. Sentiment that
 * disagrees with the tape produces nothing, which is the common case.
 */
export const newsDrive: Strategy = {
  key: 'news-drive',
  label: 'Импульс на новостях',
  bias: 'continuation',
  regimes: ['TREND', 'BREAKOUT', 'EXTREME_VOLATILITY'],

  evaluate(context): StrategyCandidate | null {
    const pulse = context.news;
    if (!pulse || pulse.confidence <= 0) return null;
    if (Math.abs(pulse.sentiment) < NEWS.leanThreshold) return null;
    // Old news is priced in; something has to be moving the story right now.
    if (!pulse.burst && pulse.fresh < NEWS.minHeadlines) return null;

    const side = pulse.sentiment > 0 ? 'LONG' : 'SHORT';
    const s = sign(side);
    const { setup, entry } = context.views;

    // The tape has to be telling the same story as the wire.
    if (s * trendVote(setup) <= 0) return null;
    const impulse = entry.candles.slice(-IMPULSE_BARS);
    if (impulse.length < IMPULSE_BARS) return null;
    const travelled = (s * (impulse[impulse.length - 1].close - impulse[0].open)) / entry.atr;
    if (travelled <= 0.3) return null;
    if (context.vwap !== null && s * (context.price - context.vwap) < 0) return null;

    // Anchor the stop to the level the impulse started from.
    const level = recentExtreme(entry.candles, IMPULSE_BARS * 3, side === 'LONG' ? 'low' : 'high');
    if (!Number.isFinite(level)) return null;

    const lean = clamp((Math.abs(pulse.sentiment) - NEWS.leanThreshold) / (0.8 - NEWS.leanThreshold), 0, 1);
    const coverage = clamp(pulse.fresh / (NEWS.minHeadlines * 2), 0, 1);

    return {
      strategy: 'news-drive',
      direction: side,
      invalidation: level - s * 0.4 * entry.atr,
      // Entry is judged from where the impulse began, so a move that has
      // already run its course scores as chased rather than fresh.
      triggerPrice: impulse[0].open,
      quality: clamp(
        0.3 * lean + 0.2 * pulse.confidence + 0.2 * coverage + 0.3 * entryConfirmation(entry, side),
        0,
        1,
      ),
      reasons: [
        `${pulse.fresh} fresh headlines leaning ${side === 'LONG' ? 'bullish' : 'bearish'}`,
        `Headline tone ${pulse.sentiment > 0 ? '+' : ''}${pulse.sentiment.toFixed(2)} across ${pulse.count} stories`,
        `1m price moving the same way, ${travelled.toFixed(1)} ATR so far`,
      ],
    };
  },
};
