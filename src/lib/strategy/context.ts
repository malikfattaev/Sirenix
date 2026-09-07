import { SESSION, type TimeframeRole } from '@/lib/config';
import { rangeOf, sessionVwap } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import type { NewsPulse } from '@/lib/news';
import { openingRangeEnd, sessionStart } from '@/lib/market/session';
import { detectRegime } from './regime';
import { buildViews } from './views';
import type { MarketContext } from './types';

export interface ContextInput {
  instrumentId: string;
  candles: Record<TimeframeRole, Candle[]>;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number;
  decimals: number;
  marketStatus: string;
  now: number;
  /**
   * Omitted by the replay: feeds only reach back a few hours, so a backtest has
   * no honest way to know what the wires were saying at the time. The news
   * component then sits at neutral and the historical result stays comparable.
   */
  news?: NewsPulse | null;
}

/**
 * Assembles the complete picture the strategies work from: every timeframe
 * view, the session VWAP and opening range, and what the market is doing.
 * Returns null when there is not enough history for a trustworthy read.
 */
export function buildContext(input: ContextInput): MarketContext | null {
  const views = buildViews(input.candles);
  if (!views) return null;

  const start = sessionStart(input.now);
  const { regime, reason: regimeReason } = detectRegime(views);

  return {
    instrumentId: input.instrumentId,
    views,
    price: input.price,
    bid: input.bid,
    ask: input.ask,
    spread: input.spread,
    decimals: input.decimals,
    marketStatus: input.marketStatus,
    now: input.now,
    regime,
    regimeReason,
    vwap: sessionVwap(views.setup.candles, start),
    news: input.news ?? null,
    session: { start, openingRange: openingRange(views.entry.candles, input.now) },
  };
}

/** High and low of the first minutes of the session, once that window is complete. */
function openingRange(entryCandles: Candle[], now: number): { high: number; low: number } | null {
  const start = sessionStart(now);
  const end = openingRangeEnd(now);
  if (now < end) return null;

  const window = entryCandles.filter((candle) => candle.time >= start && candle.time < end);
  if (window.length < SESSION.openingRangeMinutes / 2) return null;
  return rangeOf(window, window.length);
}

