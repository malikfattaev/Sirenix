import type { Horizon, Regime, StrategyKey, Timeframe, TimeframeRole } from '@/lib/config';
import type { Level, Pivot } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import type { NewsPulse } from '@/lib/news';

export type Direction = 'LONG' | 'SHORT';
export type SignalType = Direction | 'WAIT';
export type Structure = 'up' | 'down' | 'range';

/** Everything known about one timeframe at one moment in time. */
export interface TimeframeView {
  role: TimeframeRole;
  timeframe: Timeframe;
  label: string;
  candles: Candle[];
  close: number;
  ema9: number;
  ema20: number;
  ema50: number | null;
  rsi: number;
  atr: number;
  /** ATR as a percentage of price — a scale-free volatility read. */
  atrPercent: number;
  /** Current ATR divided by its recent median; >1 means volatility is expanding. */
  atrRatio: number;
  levels: Level[];
  swingHighs: Pivot[];
  swingLows: Pivot[];
  structure: Structure;
}

export type Views = Record<TimeframeRole, TimeframeView>;

/** The full picture a strategy reasons about. */
export interface MarketContext {
  instrumentId: string;
  views: Views;
  /** Live mid price, or the last closed 1m price when the market is shut. */
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number;
  decimals: number;
  marketStatus: string;
  now: number;
  regime: Regime;
  regimeReason: string;
  /** Session-anchored VWAP on the setup frame, null before enough data. */
  vwap: number | null;
  /** What the newswires are saying, or null when the instrument has no feeds. */
  news: NewsPulse | null;
  session: { start: number; openingRange: { high: number; low: number } | null };
}

/** One weighted ingredient of a setup's score. */
export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  /** 0-1 quality. */
  value: number;
}

/** What a strategy proposes before risk and scoring are applied. */
export interface StrategyCandidate {
  strategy: StrategyKey;
  direction: Direction;
  /** Price level that proves the idea wrong — the stop is placed beyond it. */
  invalidation: number;
  /**
   * The price at which the setup triggered. Entries far past it are stale, so
   * this is what stops the system from chasing a move that already happened.
   */
  triggerPrice: number;
  /** Strategy-specific target, used when it is closer than the generic one. */
  preferredTarget?: number;
  /** How well this particular pattern is formed, 0-1. */
  quality: number;
  reasons: string[];
}

/**
 * Whether a setup joins the prevailing move or trades against it. Scoring has
 * to know: a fade needs a trend to be *present*, not to agree with it, so
 * grading both kinds on trend agreement silently rejects every fade.
 */
export type StrategyBias = 'continuation' | 'reversion';

export interface Strategy {
  key: StrategyKey;
  label: string;
  bias: StrategyBias;
  /** Regimes this strategy is allowed to fire in. */
  regimes: Regime[];
  evaluate(context: MarketContext): StrategyCandidate | null;
}

export interface TradePlan {
  entryLow: number;
  entryHigh: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  /** Second, further target when the move has room; null when it does not. */
  takeProfit2: number | null;
  riskReward: number;
  stopReason: string;
  targetReason: string;
}

/** Scalps are minutes long; swing signals are held for a day or two. */

export interface Signal {
  rejections?: SignalRejection[];
  instrumentId: string;
  epic: string;
  label: string;
  horizon: Horizon;
  type: SignalType;
  /** Confluence strength, 0-100. Not a probability of winning. */
  score: number;
  strategy: StrategyKey | 'intraday-momentum' | null;
  strategyLabel: string | null;
  regime: Regime;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number;
  decimals: number;
  marketStatus: string;
  vwap: number | null;
  /** Headline reading behind the signal, null when the market has no feeds. */
  news: NewsPulse | null;
  plan: TradePlan | null;
  reasons: string[];
  /** Why the system is standing aside, when it is. */
  blockedBy: string | null;
  /**
   * Said about a signal that is already running: how far it has gone and
   * whether the entry is still there. Null while nothing is running.
   */
  note?: string | null;
  updatedAt: number;
}

export interface SignalRejection {
  code: string;
  detail: string;
  strategy?: string;
  direction?: Direction;
  score?: number;
  plan?: TradePlan;
}
