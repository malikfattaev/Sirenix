/**
 * Single source of truth for every tunable parameter of the application.
 * The strategy layer contains no magic numbers — they all live here.
 */

export type Timeframe = 'MINUTE' | 'MINUTE_5' | 'MINUTE_15' | 'HOUR';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  MINUTE: 60_000,
  MINUTE_5: 5 * 60_000,
  MINUTE_15: 15 * 60_000,
  HOUR: 60 * 60_000,
};

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  MINUTE: '1m',
  MINUTE_5: '5m',
  MINUTE_15: '15m',
  HOUR: '1H',
};

/**
 * The scalping ladder. Decisions are driven by 15m/5m/1m; the hourly frame only
 * vetoes trades taken straight into a very strong move.
 */
export const TIMEFRAME_ROLES = {
  context: 'HOUR',
  direction: 'MINUTE_15',
  setup: 'MINUTE_5',
  entry: 'MINUTE',
} as const satisfies Record<string, Timeframe>;

export type TimeframeRole = keyof typeof TIMEFRAME_ROLES;

/** Candles per role: enough history for the slowest indicator plus structure. */
export const CANDLE_DEPTH: Record<TimeframeRole, number> = {
  context: 200,
  direction: 300,
  setup: 400,
  entry: 600,
};

export interface InstrumentConfig {
  id: string;
  epic: string;
  label: string;
}

export const INSTRUMENTS: InstrumentConfig[] = [
  { id: 'GOLD', epic: 'GOLD', label: 'GOLD' },
  { id: 'BRENT', epic: 'OIL_BRENT', label: 'BRENT OIL' },
];

/**
 * Equity indices traded on the daily mean-reversion signal.
 *
 * Research across 47 markets found that only equity indices, at a holding
 * period of a day or two, produce an effect large enough to clear the spread.
 * They are cheap to trade (under 5 bps) and move together enough that a sharp
 * one-day move tends to be partly given back.
 */
export const INDEX_INSTRUMENTS: InstrumentConfig[] = [
  { id: 'US30', epic: 'US30', label: 'US 30' },
  { id: 'US500', epic: 'US500', label: 'US 500' },
  { id: 'US100', epic: 'US100', label: 'US TECH 100' },
  { id: 'RTY', epic: 'RTY', label: 'RUSSELL 2000' },
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40' },
  { id: 'UK100', epic: 'UK100', label: 'UK 100' },
  { id: 'FR40', epic: 'FR40', label: 'FRANCE 40' },
  { id: 'NL25', epic: 'NL25', label: 'NETHERLANDS 25' },
  { id: 'SP35', epic: 'SP35', label: 'SPAIN 35' },
  { id: 'SW20', epic: 'SW20', label: 'SWITZERLAND 20' },
  { id: 'J225', epic: 'J225', label: 'JAPAN 225' },
  { id: 'HK50', epic: 'HK50', label: 'HONG KONG 50' },
  { id: 'HSTECH', epic: 'HSTECH', label: 'HK TECH' },
  { id: 'HSCE', epic: 'HSCE', label: 'CHINA H-SHARES' },
  { id: 'CN50', epic: 'CN50', label: 'CHINA A50' },
  { id: 'AU200', epic: 'AU200', label: 'AUSTRALIA 200' },
];

export const ALL_INSTRUMENTS: InstrumentConfig[] = [...INSTRUMENTS, ...INDEX_INSTRUMENTS];

export function findInstrument(id: string): InstrumentConfig | undefined {
  return ALL_INSTRUMENTS.find((instrument) => instrument.id.toLowerCase() === id.toLowerCase());
}

/**
 * The daily mean-reversion signal, settled by a grid search that only accepted
 * settings profitable in *both* halves of a seven-month, sixteen-index sample.
 *
 * Backtest at these values: 2014 trades, 62.8% win rate, +0.029R per trade,
 * 11 of 16 indices and 13 of 20 months positive. Pulling the target closer
 * raises the win rate and destroys the profit: at 2.0 ATR the win rate reaches
 * 70% but the first half of the sample loses money, and at 1.0 ATR the win rate
 * is 83% and the total return is zero.
 */
export const SWING = {
  /** Hours of price change the fade score is measured over. */
  lookbackHours: 24,
  /** Minimum absolute fade score before a signal is issued. */
  scoreThreshold: 1.3,
  /** Stop and target as multiples of hourly ATR. Reversion needs a wide stop. */
  stopAtr: 6,
  targetAtr: 3,
  /** Positions are closed at market after this long. */
  holdHours: 48,
  /** Hourly candles to load per instrument. */
  candleDepth: 300,
  /** Fade score that maps to a displayed strength of 100. */
  scoreCeiling: 3.0,
} as const;

export const INDICATORS = {
  emaFast: 9,
  emaMid: 20,
  emaSlow: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  /** Bars on each side of a pivot required to confirm a swing high/low. */
  swingLookback: 2,
  /** Candles scanned for support/resistance pivots. */
  levelLookback: 150,
  /** Candles used to measure whether volatility is expanding or contracting. */
  volatilityLookback: 60,
} as const;

/**
 * These CFDs trade around the clock on weekdays and roll over at 22:00 UTC,
 * which is where the intraday VWAP and the opening range are anchored.
 */
export const SESSION = {
  rolloverHourUtc: 22,
  /** Length of the opening range measured from the session start, in minutes. */
  openingRangeMinutes: 30,
  /** US session open in UTC — the most active window for gold. */
  usOpenHourUtc: 13,
} as const;

export type Regime = 'TREND' | 'RANGE' | 'BREAKOUT' | 'CHOP' | 'EXTREME_VOLATILITY';

export type StrategyKey =
  | 'trend-pullback'
  | 'breakout-retest'
  | 'momentum'
  | 'vwap-pullback'
  | 'sr-bounce'
  | 'mean-reversion'
  | 'failed-breakout'
  | 'opening-range'
  | 'pullback-fade';

/**
 * Tie-breaker order when several strategies fire at once. The lists differ per
 * instrument because gold and oil do not behave the same way.
 */
export const STRATEGY_PRIORITY: Record<string, StrategyKey[]> = {
  GOLD: [
    'pullback-fade',
    'trend-pullback',
    'vwap-pullback',
    'breakout-retest',
    'momentum',
    'sr-bounce',
    'failed-breakout',
    'opening-range',
    'mean-reversion',
  ],
  BRENT: [
    'pullback-fade',
    'trend-pullback',
    'breakout-retest',
    'momentum',
    'vwap-pullback',
    'sr-bounce',
    'failed-breakout',
    'opening-range',
    'mean-reversion',
  ],
};

/** Regime thresholds, all expressed in ATR multiples so they scale per market. */
export const REGIME = {
  /** EMA9-to-EMA50 separation on the setup frame that counts as a real trend. */
  trendSeparationAtr: 1.0,
  /** Below this the moving averages are flat and the market is ranging. */
  rangeSeparationAtr: 0.45,
  /** Current ATR versus its recent median; above this the market is unstable. */
  extremeAtrRatio: 2.2,
  /** Recent range height, in ATR, under which the market counts as compressed. */
  compressionAtr: 2.6,
  /** Bars used to measure the local range for breakout detection. */
  rangeLookback: 24,
} as const;

/**
 * The thresholds that decide how selective the system is. They are grouped here
 * — and passed around rather than imported directly — so a backtest can replay
 * the same code with different settings and show whether a change is better.
 */
/**
 * How a position is managed once it is open. Placing a stop and a target and
 * waiting is only one option, and for a scalp usually not the best one.
 */
export interface ExitPolicy {
  /** Move the stop to break-even once price has travelled this many R. */
  breakEvenAtR: number | null;
  /** Once in profit, trail the stop this many entry-frame ATRs behind the best price. */
  trailAtr: number | null;
  /** Bank half the position at the first target and let the rest run to the second. */
  scaleOut: boolean;
}

export const NO_MANAGEMENT: ExitPolicy = {
  breakEvenAtR: null,
  trailAtr: null,
  scaleOut: false,
};

export interface StrategyTuning {
  /** Minimum confluence score (0-100) required to issue a signal. */
  minScore: number;
  /** Reject a setup whose first target cannot pay this much. */
  minRiskReward: number;
  /** Stop distance beyond the invalidation level, in entry-frame ATRs. */
  stopBufferAtr: number;
  /** Floor and ceiling on the stop distance, in setup-frame ATRs. */
  minStopAtr: number;
  maxStopAtr: number;
  /** The move is already gone once price is this far past the trigger, in 1m ATRs. */
  maxChaseAtr: number;
  /** Risk must cover the spread at least this many times. */
  minRiskToSpread: number;
  /** The first target must cover the spread at least this many times. */
  minRewardToSpread: number;
  /**
   * Ceiling on how far the first target may sit, in setup ATRs. A scalp that
   * needs a bigger move than this to pay is not a scalp.
   */
  maxTargetAtr: number;
  /** A scalp still open after this many minutes is closed at market. */
  maxHoldMinutes: number;
  /** Bars to stand aside after a trade closes, so one move is traded once. */
  cooldownBars: number;
  /** What happens to the position between entry and exit. */
  exit: ExitPolicy;
  /**
   * Setups allowed to fire. `null` means all of them; a list restricts the
   * system to the strategies that have earned their place on this instrument.
   */
  enabledStrategies: StrategyKey[] | null;
}

export const DEFAULT_TUNING: StrategyTuning = {
  minScore: 62,
  minRiskReward: 1.5,
  stopBufferAtr: 0.6,
  minStopAtr: 0.7,
  maxStopAtr: 2.6,
  maxChaseAtr: 1.8,
  minRiskToSpread: 3,
  minRewardToSpread: 5,
  maxTargetAtr: 1.8,
  maxHoldMinutes: 20,
  cooldownBars: 5,
  exit: NO_MANAGEMENT,
  /**
   * Trend pullback, S/R bounce, VWAP pullback and failed breakout lost money in
   * all four independent measurements (both instruments x both halves of a
   * 21-day sample), so they are off by default. They are still in the codebase:
   * re-enable one here and run `scripts/lab.ts` to re-test it on fresh data.
   */
  enabledStrategies: [
    'breakout-retest',
    'momentum',
    'pullback-fade',
    'mean-reversion',
    'opening-range',
  ],
};

/**
 * How long a signal stays open before it is settled at market. A scalp that has
 * not resolved in half an hour is stale; a daily fade is given its full holding
 * period, because overshooting first is exactly how the setup behaves.
 */
export const SIGNAL_LIFETIME_MS: Record<'scalp' | 'swing', number> = {
  scalp: 30 * 60_000,
  swing: SWING.holdHours * 60 * 60_000,
};

/** Two signals of the same shape inside this window count as one. */
export const DEDUPE_WINDOW_MS: Record<'scalp' | 'swing', number> = {
  scalp: 10 * 60_000,
  swing: 6 * 60 * 60_000,
};

/**
 * Prices are polled far more often than the analysis: quotes move continuously,
 * while the candles the strategy reads only change once a minute.
 */
export const PRICE_REFRESH_INTERVAL_MS = 1_000;
export const SIGNAL_REFRESH_INTERVAL_MS = 1_000;

/** Server-side quote cache, so extra browser tabs do not multiply upstream calls. */
export const QUOTE_CACHE_MS = 700;
