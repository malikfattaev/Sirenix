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

/** Which headlines belong to an instrument, and where to look for them. */
export interface NewsTopic {
  /** Ids from NEWS_FEEDS, most specific source first. */
  feeds: string[];
  /** A headline counts for this instrument when it mentions one of these. */
  match: string[];
}

export interface InstrumentConfig {
  id: string;
  epic: string;
  label: string;
  news?: NewsTopic;
  /**
   * Horizons this market runs on, and the starting point for the settings
   * module, which can change it per market at any time.
   *
   * Worth knowing while reading these: over 31 days of one-minute candles the
   * minute engine is negative on Brent at every threshold tried, 23% win and
   * -23.4R, the worst of any market screened, because its round trip costs 0.70
   * of a one-minute move. Gold is about break-even there. Both are positive on
   * both halves at the hour scale. Those numbers sit on the settings page next
   * to the switch, so the choice is made in front of them rather than behind
   * them. Research scripts that build instruments on the fly leave this out and
   * get both.
   */
  horizons?: Horizon[];
}

export const INSTRUMENTS: InstrumentConfig[] = [
  {
    id: 'GOLD',
    epic: 'GOLD',
    label: 'GOLD',
    horizons: ['scalp', 'intraday'],
    news: {
      feeds: ['investing-commodities', 'investing-commodity-news', 'fxstreet', 'marketwatch'],
      match: ['gold', 'bullion', 'xau', 'precious metal', 'safe haven', 'safe-haven'],
    },
  },
  {
    id: 'BRENT',
    epic: 'OIL_BRENT',
    label: 'BRENT OIL',
    horizons: ['scalp', 'intraday'],
    news: {
      feeds: ['oilprice', 'investing-commodities', 'investing-commodity-news', 'cnbc-energy', 'fxstreet'],
      match: ['oil', 'brent', 'crude', 'wti', 'opec', 'petroleum', 'refinery', 'refiner', 'barrel'],
    },
  },
];

/**
 * Public headline feeds. All are keyless RSS, so nothing here depends on a
 * paid data vendor; a feed that stops responding is simply skipped.
 */
export interface NewsFeedConfig {
  id: string;
  label: string;
  url: string;
}

export const NEWS_FEEDS: NewsFeedConfig[] = [
  { id: 'investing-commodities', label: 'Investing.com', url: 'https://www.investing.com/rss/commodities.rss' },
  { id: 'investing-commodity-news', label: 'Investing.com', url: 'https://www.investing.com/rss/news_11.rss' },
  { id: 'oilprice', label: 'OilPrice', url: 'https://oilprice.com/rss/main' },
  { id: 'fxstreet', label: 'FXStreet', url: 'https://www.fxstreet.com/rss/news' },
  { id: 'cnbc-energy', label: 'CNBC Energy', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { id: 'marketwatch', label: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
];

/**
 * Headline reading. Feeds publish every few minutes at best, so they are polled
 * far more slowly than prices and the result is shared by every request.
 */
export const NEWS = {
  /** How long a fetched feed stays usable before it is pulled again. */
  cacheMs: 3 * 60_000,
  /** How long a scored reading is reused, so a per-second poll is nearly free. */
  pulseCacheMs: 20_000,
  /** Give up on a slow feed rather than hold up the whole analysis. */
  requestTimeoutMs: 8_000,
  /** Headlines older than this are ignored entirely. */
  windowHours: 12,
  /** A headline's weight halves every this many hours. */
  halfLifeHours: 3,
  /** Recent window used to decide whether a story is breaking right now. */
  freshHours: 2,
  /** Fresh headlines per hour, over the window average, that counts as a burst. */
  burstRatio: 2,
  /** Sentiment past this counts as a real lean rather than noise. */
  leanThreshold: 0.3,
  /** Below this many matched headlines the reading is treated as unusable. */
  minHeadlines: 3,
  /** Headlines kept for display on a card. */
  maxHeadlines: 4,
} as const;

export const ALL_INSTRUMENTS: InstrumentConfig[] = INSTRUMENTS;

export function findInstrument(id: string): InstrumentConfig | undefined {
  return ALL_INSTRUMENTS.find((instrument) => instrument.id.toLowerCase() === id.toLowerCase());
}

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
  | 'pullback-fade'
  | 'news-drive';

/**
 * Tie-breaker order when several strategies fire at once, used only when two
 * setups score the same. Gold and oil have measured orders of their own; every
 * other market falls back to the generic one.
 */
export const DEFAULT_STRATEGY_PRIORITY: StrategyKey[] = [
  'pullback-fade',
  'breakout-retest',
  'news-drive',
  'momentum',
  'trend-pullback',
  'vwap-pullback',
  'sr-bounce',
  'failed-breakout',
  'opening-range',
  'mean-reversion',
];

export const STRATEGY_PRIORITY: Record<string, StrategyKey[]> = {
  GOLD: [
    'pullback-fade',
    'trend-pullback',
    'vwap-pullback',
    'breakout-retest',
    'news-drive',
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
    'news-drive',
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
   *
   * News momentum is on but cannot be measured that way: feeds only reach back
   * a few hours, so the replay sees no headlines and the strategy produces
   * nothing there. It is live-only by nature.
   */
  enabledStrategies: [
    // 'breakout-retest' is off: over 20 days and 100 signals across the six
    // markets it won 31% and lost 27.2R, negative in both halves of the sample
    // and on every market. It is the largest sample of any strategy here and
    // the only one that loses consistently, so it stays off until it can be
    // shown to work on data it was not measured on.
    'momentum',
    'news-drive',
    'pullback-fade',
    'mean-reversion',
    'opening-range',
  ],
};

/**
 * The two horizons the board reads each market on.
 *
 * They are opposites on purpose: the minute-scale engine looks for a setup and
 * takes it, while the hour-scale one only joins a move that is already running.
 */
export type Horizon = 'scalp' | 'intraday';

/** Both horizons, in the order the board lays them out. */
export const HORIZONS: Horizon[] = ['scalp', 'intraday'];

export const HORIZON_LABEL: Record<Horizon, string> = {
  scalp: 'СКАЛЬПИНГ',
  intraday: 'ВНУТРИ ДНЯ',
};

/** Readable name per strategy, shown wherever a raw key would otherwise appear. */
export const STRATEGY_NAME: Record<string, string> = {
  'trend-pullback': 'Откат по тренду',
  'pullback-fade': 'Продолжение после отката',
  'breakout-retest': 'Пробой и ретест',
  momentum: 'Импульс',
  'news-drive': 'Импульс на новостях',
  'vwap-pullback': 'Откат к VWAP',
  'sr-bounce': 'Отбой от уровня',
  'mean-reversion': 'Возврат к середине',
  'failed-breakout': 'Ложный пробой',
  'opening-range': 'Пробой открытия',
  'intraday-momentum': 'Импульс внутри дня',
  'daily-reversion': 'Дневной разворот',
  'index-reversion': 'Разворот по индексу',
};

/**
 * The hour-scale continuation signal, on 15-minute candles.
 *
 * Chosen by a grid of 1,728 configurations, of which six were profitable in
 * *both* halves of an eleven-week sample; all six were continuation, none were
 * reversion, and they cluster on these values rather than being scattered,
 * which is what separates a result from a coincidence.
 *
 * Measured here: 296 trades, 3.9 a day, 51% win rate, +8.5R, every one of the
 * four months positive and 7 of 12 weeks. Gold carries it (+10.6R); Brent is
 * slightly negative (-2.1R). The edge per trade is small and the sample is
 * short, so this is a modest result, not a strong one.
 */
export const INTRADAY = {
  /** 15-minute bars the stretch is measured over. */
  lookback: 4,
  /** Minimum absolute stretch before a signal is issued. */
  threshold: 1.8,
  /** Stop and target as multiples of 15-minute ATR. */
  stopAtr: 2.5,
  targetAtr: 2,
  /** Bars the trade is held before it is closed at market. */
  holdBars: 4,
  /** Stretch that maps to a displayed strength of 100. */
  scoreCeiling: 3.5,
} as const;

/**
 * A market carries one direction at a time.
 *
 * While a signal is open the board keeps showing that signal, and no new one is
 * issued on the same market and horizon. The plan already published has a stop,
 * and the stop is the exit. Turning around before it is reached realises the
 * loss and then pays the spread again to enter at a worse price, which is
 * exactly how a market drifting around one level takes money from a system that
 * re-ranks every setup from scratch every second.
 *
 * After a losing close the market is left alone for a while instead of being
 * re-entered straight away, for the same reason: the read has just been shown
 * to be wrong, and the next few minutes are the worst time to repeat it.
 */
export const POSITION: {
  lossCooldownMs: Record<Horizon, number>;
  maxLossStreak: number;
  streakPauseMs: Record<Horizon, number>;
} = {
  lossCooldownMs: {
    scalp: 15 * 60_000,
    intraday: 60 * 60_000,
  },
  /**
   * Losses in a row that take a market off the board for a while.
   *
   * A run of six at a 50% win rate turns up about once in sixty-four attempts:
   * it cannot be designed away, and anyone promising otherwise is selling
   * something. What it can be is cut short. Three losses in a row is either the
   * market having changed character or the read being wrong about it, and
   * neither is fixed by taking the fourth trade straight away.
   */
  maxLossStreak: 3,
  /** How long the market is left alone once the streak is hit. */
  streakPauseMs: {
    scalp: 4 * 60 * 60_000,
    intraday: 12 * 60 * 60_000,
  },
};

/** How long a signal stays open before it is settled at market. */
export const SIGNAL_LIFETIME_MS: Record<Horizon, number> = {
  scalp: 30 * 60_000,
  intraday: INTRADAY.holdBars * TIMEFRAME_MS.MINUTE_15,
};

/**
 * The signal history on the dashboard.
 *
 * `visibleRows` is how much of it stands on the page before the list starts
 * scrolling: enough to see what just happened without the table pushing the
 * rest of the dashboard off the screen. `limit` is how deep the list goes,
 * which is also how much the filters have to work with.
 */
export const HISTORY = {
  visibleRows: 5,
  limit: 50,
} as const;

/**
 * Prices are polled far more often than the analysis: quotes move continuously,
 * while the candles the strategy reads only change once a minute.
 */
export const PRICE_REFRESH_INTERVAL_MS = 1_000;
export const SIGNAL_REFRESH_INTERVAL_MS = 1_000;

/**
 * The record only changes when a signal is issued or settled, and the wires
 * are read on their own cache upstream, so neither is worth a poll a second.
 */
export const STATS_REFRESH_INTERVAL_MS = 5_000;
export const NEWS_REFRESH_INTERVAL_MS = 30_000;

/** Server-side quote cache, so extra browser tabs do not multiply upstream calls. */
export const QUOTE_CACHE_MS = 700;

/**
 * How long a price may go unchanged before it stops counting as live.
 *
 * Measured on this account, the REST snapshot can sit minutes behind on a
 * market that still reports TRADEABLE, with nothing in the response to say so.
 * A signal priced off a number that old is not a signal, so past this the board
 * says the price is stale and issues nothing on that market.
 */
export const QUOTE_STALE_MS = 90_000;

/**
 * The parts of the configuration a person is expected to change while the
 * system is running.
 *
 * Everything else in `config.ts` is a measured value: changing it invalidates
 * the backtests it was chosen from, so it belongs in the file and in git rather
 * than behind a form. What is here is the shape of the board, how selective the
 * engine is, and how long it waits after being wrong.
 */
export interface Settings {
  /** Markets analysed on the board, as instrument ids. */
  markets: string[];
  /** Minimum confluence score, 0-100, required to publish a scalping signal. */
  minScore: number;
  /** Minutes a market is left alone after a losing trade, per horizon. */
  lossCooldownMinutes: Record<Horizon, number>;
  /** How many history rows stand on the page before the list scrolls. */
  historyVisibleRows: number;
  /** Which horizons run on each market, keyed by instrument id. */
  horizons: Record<string, Horizon[]>;
  /** Losses in a row that pause a market. */
  maxLossStreak: number;
}

export const SETTINGS_LIMITS = {
  minScore: { min: 30, max: 95 },
  lossCooldownMinutes: { min: 0, max: 240 },
  historyVisibleRows: { min: 3, max: 20 },
  maxLossStreak: { min: 2, max: 10 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  markets: INSTRUMENTS.map((instrument) => instrument.id),
  minScore: DEFAULT_TUNING.minScore,
  lossCooldownMinutes: {
    scalp: POSITION.lossCooldownMs.scalp / 60_000,
    intraday: POSITION.lossCooldownMs.intraday / 60_000,
  },
  historyVisibleRows: HISTORY.visibleRows,
  horizons: Object.fromEntries(
    INSTRUMENTS.map((instrument) => [instrument.id, instrument.horizons ?? HORIZONS]),
  ),
  maxLossStreak: POSITION.maxLossStreak,
};

/** Who a person is on this install. */
export type Role = 'admin' | 'user';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Администратор',
  user: 'Пользователь',
};

/**
 * Accounts and sessions.
 *
 * A session is a random token kept in a cookie the browser cannot read from
 * script; only its hash is stored, so a copy of the database does not hand
 * anyone a way in.
 */
export const AUTH = {
  sessionDays: 30,
  minLoginLength: 3,
  maxLoginLength: 32,
  minPasswordLength: 8,
  cookieName: 'sirenix_session',
} as const;
