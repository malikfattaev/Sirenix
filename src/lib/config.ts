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
   * Both markets run on `scalp` alone. The quarter-hour engine was measured
   * across nine stop/target and threshold combinations on each: on Brent every
   * one of the nine is negative over both halves of the sample, and on gold the
   * best of them turns +10.8R in the half it was found in into -2.0R in the
   * half it was not, which is the shape of a fitted parameter rather than of an
   * edge. It stays off until something measured on data it has not seen says
   * otherwise. Research scripts that build instruments on the fly leave this
   * out and get every horizon.
   */
  horizons?: Horizon[];
}

/**
 * The board: the eight indices that produce enough signals to be judged.
 *
 * Gold and Brent were taken off at the owner's request after the six-week
 * screen. Brent was the worst market measured anywhere on the field, -17.3R
 * over 31 signals with a 19% win rate; gold returned -3.2R and, unlike the
 * indices, was positive in the first half and negative in the second, which is
 * the shape of noise rather than of a market that suits the engine.
 *
 * What replaced them is every index Capital quotes that fires often enough to
 * be read at all. Twenty-six markets were screened over forty-one days of
 * one-minute candles; ten produced fewer than twenty signals in six weeks and
 * are not here, because a market that trades four times can post any number.
 *
 * **None of the eight is profitable, and the order below is by cost, not by
 * result.** Over the same six weeks the engine returned between +0.5R and
 * -10.1R on them, and the reason is not the board: `direction.ts` followed all
 * 453 signals with the stop and the target removed and found them right 47% of
 * the time at twenty minutes, 49% at an hour and 45% at two hours. Every setup
 * measured alone loses on both halves as well. Until an entry with a measured
 * edge exists, adding a market adds signals and adds losses, and the honest
 * reason to run these eight is that they are the cheapest and busiest place to
 * collect live evidence, not that they pay.
 *
 * The figure on each line is the round trip as a share of a fifteen-minute ATR,
 * from `tradingHours.ts` — the one number here known in advance of any trade.
 *
 * No headline feeds: an index has no single story the way gold and oil do, and
 * a feed matched on "stocks" would score every market at once.
 */
export const INSTRUMENTS: InstrumentConfig[] = [
  /** 0.035-0.048. The cheapest quote on the board. -9.3R over 83 signals. */
  { id: 'US30', epic: 'US30', label: 'US 30', horizons: ['scalp'] },
  /** 0.038-0.049. The least bad of the eight, +0.5R over 80 signals, which is zero. */
  { id: 'US100', epic: 'US100', label: 'US TECH 100', horizons: ['scalp'] },
  /** 0.043-0.070 in session. -2.9R over 34 signals. */
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40', horizons: ['scalp'] },
  /** 0.050-0.093. -2.9R over 30 signals. */
  { id: 'US500', epic: 'US500', label: 'US 500', horizons: ['scalp'] },
  /** 0.071-0.077, flat around the clock. -0.7R over 47 signals. */
  { id: 'J225', epic: 'J225', label: 'JAPAN 225', horizons: ['scalp'] },
  /** 0.071 in session but 0.50 overnight; the spread gate refuses it then. -5.7R. */
  { id: 'FR40', epic: 'FR40', label: 'FRANCE 40', horizons: ['scalp'] },
  /** 0.085 in session, 0.32 overnight. -6.3R over 17 signals, the thinnest here. */
  { id: 'UK100', epic: 'UK100', label: 'UK 100', horizons: ['scalp'] },
  /** 0.188-0.204, the dearest quote kept. -10.1R over 59 signals. */
  { id: 'NL25', epic: 'NL25', label: 'NETHERLANDS 25', horizons: ['scalp'] },
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

/**
 * No market on the board subscribes to any of these at the moment.
 *
 * They are commodity and energy wires, and they were read by gold and Brent
 * until both came off the board. An index has no single story the way a barrel
 * of oil does — a feed matched on "stocks" would score all eight at once and
 * tell none of them apart — so nothing here is fetched until a market with a
 * story of its own comes back.
 */
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
  /**
   * Risk must cover the spread at least this many times.
   *
   * This is the single most important number in this file. Across the opening
   * range study, the intraday momentum study and the short-horizon study, the
   * result of a trade tracked the round trip almost exactly: pay a third of the
   * risk in spread and lose about a third of it, pay a tenth and lose about a
   * tenth. Three — where this sat for a long time — allows the spread to be a
   * third of the stop, which is the expensive end of that range.
   */
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
  /**
   * UTC hours, inclusive, in which a signal may be issued. `null` means any.
   *
   * The spread barely changes across the day but the distance price travels
   * changes by a factor of three, so the same quote that costs a tenth of an
   * hour's move at the New York open costs two fifths of it once the cash
   * markets are shut. A signal issued in the second kind of hour is behind
   * before it is filled, and no amount of reading the chart fixes that.
   */
  tradingHours: { from: number; to: number } | null;
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
  /**
   * Six, measured — but measured against a smaller claim than it first carried.
   *
   * Swept over 3, 4, 5, 6, 8 and 10 on 21 days of one-minute candles, six came
   * out best on US 30 at +6.8R against three's +4.5R, and that was written down
   * here as the gate having found the one market that pays. It had not. The
   * same screen re-run over forty-one days puts US 30 at -9.3R: those three
   * weeks were the good half of a six-week sample, and reading them alone is
   * the error this repository exists to avoid.
   *
   * What survives is narrower and still worth having. Trades whose round trip
   * exceeds a quarter of their risk returned -1.016R in the opening-range study
   * against -0.047R for those paying under a tenth, a difference of twenty
   * times, and three is the setting that allows the spread to be a third of the
   * stop. Six does not make the engine profitable. It stops it paying a toll
   * larger than the road on trades that were never going to cover it.
   */
  minRiskToSpread: 6,
  minRewardToSpread: 5,
  maxTargetAtr: 1.8,
  maxHoldMinutes: 20,
  /**
   * Off, measured, and worth recording why.
   *
   * The hourly cost table makes a strong case for a clock: the round trip is
   * roughly flat across the day while the distance travelled triples, so an
   * hour's move covers the spread seventeen times over at the New York open and
   * two and a half times at nine in the evening. Every window built from that —
   * London, the overlap, the New York cash session, the working day — lost to
   * trading around the clock on the live engine: on US 30, +6.8R around the
   * clock against +2.9R for the best window.
   *
   * The reason is that `minRiskToSpread` already does this job and does it
   * better. It measures the spread that is actually quoted against the stop
   * that is actually planned, trade by trade, so an expensive hour is refused
   * by name rather than by the clock, and a cheap hour outside the window is
   * still taken. A clock is a worse instrument for reading the same thing.
   */
  tradingHours: null,
  cooldownBars: 5,
  exit: NO_MANAGEMENT,
  /**
   * Trend pullback, S/R bounce, VWAP pullback and failed breakout lost money in
   * all four independent measurements (both instruments x both halves of a
   * 21-day sample), so they are off by default. They are still in the codebase:
   * re-enable one here and run `scripts/research/lab.ts` to re-test it on fresh data.
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

export interface IntradayTuning {
  lookback: number;
  threshold: number;
  stopAtr: number;
  targetAtr: number;
  scoreCeiling: number;
}

/**
 * One profile per market on the board, each its own object.
 *
 * Every one of them starts as a copy of the baseline and stays there until an
 * independent sample supports moving it. They are separate copies rather than
 * one shared object so that changing a market's settings changes that market
 * and not the whole board — which is the only reason this map exists.
 *
 * Built from `INSTRUMENTS` rather than listed, so a market added to the board
 * cannot arrive without a profile, and one taken off cannot leave a profile
 * behind that nothing reads. It used to name gold and Brent, both of which have
 * since come off.
 */
export const INTRADAY_BY_MARKET: Record<string, IntradayTuning> = Object.fromEntries(
  INSTRUMENTS.map((instrument) => [instrument.id, { ...INTRADAY }]),
);

export function intradayTuning(instrumentId: string): IntradayTuning {
  return INTRADAY_BY_MARKET[instrumentId] ?? INTRADAY;
}

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

/**
 * How long a signal is followed before it is settled at whatever the market
 * happens to be, per horizon. `null` means it is not settled that way at all:
 * the trade runs until price reaches its stop or its target.
 *
 * Those two are the outcomes the plan is built around, and a deadline is a
 * third one that nobody asked for. It was not a small effect: across the first
 * eight signals the record produced three stops, five deadlines and **not one
 * target**, so the clock was not a safety net underneath the plan, it was the
 * plan's usual ending — and a trade cut at an arbitrary minute is neither the
 * win nor the loss the entry was reasoned about.
 */
export const SIGNAL_LIFETIME_MS: Record<Horizon, number | null> = {
  // Twenty minutes, because that is the number the measurement picked. Over 14
  // days of one-minute candles on both markets the same entries returned -6.5R
  // held for 20 minutes, -7.2R for an hour and -10.4R for anything longer, and
  // past four hours the table stops moving because no trade lives that long
  // anyway. Removing the cut does not let winners run; it lets the trades that
  // were being closed small reach a full stop instead.
  scalp: 20 * 60_000,
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
/**
 * What the engine has actually been measured to return per signal.
 *
 * Not a forecast and not a target: the result of replaying the live logic,
 * unchanged, over 41 days of one-minute candles on the eleven markets that fire
 * often enough to be judged. It is stated here so the interface can state it
 * too, because a board that prints an entry, a stop and a target beside a
 * strength out of a hundred reads as a recommendation, and this one has not
 * earned that reading.
 *
 * The number is stable to a hundredth across everything that has been tried:
 * -0.129R held twenty minutes, -0.106R with a wide stop held two hours,
 * -0.105R with a wide stop held twelve. Per market it runs from -0.04R to
 * -0.56R and per strategy from -0.095R to -0.266R. That constancy is the point.
 * It is not a setting that is wrong; it is the round trip, and nothing in the
 * engine earns it back.
 *
 * `direction.ts` says why: the side the engine picks is right 45% of the time
 * at twenty minutes, 49% at an hour and 44% at two hours, and its own
 * confluence score correlates -0.031 with what the trade goes on to do. There
 * is no edge here yet.
 *
 * Delete this the day a replay on data the engine has not seen comes back
 * positive on both halves, and not before.
 */
export const MEASURED_EDGE = {
  /** Mean result per signal, in units of the risk planned for it. */
  expectancyR: -0.11,
  signals: 525,
  days: 41,
  markets: 11,
  /** How much the confluence score explains of the outcome. Nothing. */
  scoreCorrelation: -0.031,
} as const;

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
 * The server's own analysis clock.
 *
 * Everything above is a browser polling the server. On its own that makes the
 * record a log of when somebody happened to be watching: no open tab means no
 * analysis, so no signal is issued and, worse, no signal already running is
 * followed to its stop or its target. The loop below is what makes the history
 * mean something — the engine runs whether or not anyone is looking.
 *
 * The open interval is deliberately finer than the minute the entry candle
 * closes on, because an exit is also checked against the live quote, and a
 * level taken out now should be settled now rather than at the next bar.
 */
export const ANALYSIS_LOOP = {
  /** Let the server finish coming up before the first sweep. */
  startupDelayMs: 5_000,
  /** While any market has a session running. */
  openIntervalMs: 15_000,
  /** While every market is closed: nothing moves, so nothing is missed. */
  closedIntervalMs: 5 * 60_000,
  /** After a sweep that threw — a lost socket, a refused session, a timeout. */
  retryIntervalMs: 30_000,
} as const;

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
