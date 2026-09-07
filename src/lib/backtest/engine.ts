import { capital } from '@/lib/capital/client';
import {
  CANDLE_DEPTH,
  DEFAULT_TUNING,
  TIMEFRAME_MS,
  TIMEFRAME_ROLES,
  type InstrumentConfig,
  type StrategyKey,
  type ExitPolicy,
  type StrategyTuning,
  type TimeframeRole,
} from '@/lib/config';
import { closedBefore, toCandles, type Candle } from '@/lib/market/candles';
import { buildContext, decide, type TradePlan } from '@/lib/strategy';

export interface BacktestTrade {
  strategy: StrategyKey;
  direction: 'LONG' | 'SHORT';
  score: number;
  openedAt: number;
  closedAt: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  plannedRiskReward: number;
  exitPrice: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  /** Result in units of risk, after paying the real spread on entry. */
  r: number;
  holdMinutes: number;
}

export interface StrategyStats {
  strategy: StrategyKey;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRiskReward: number;
  totalR: number;
  expectancy: number;
}

export interface BacktestResult {
  instrumentId: string;
  label: string;
  from: number;
  to: number;
  barsTested: number;
  signals: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  avgRiskReward: number;
  avgScore: number;
  avgHoldMinutes: number;
  totalR: number;
  profitFactor: number | null;
  /** Mean result per trade, in units of risk — the headline number. */
  expectancy: number;
  byStrategy: StrategyStats[];
  trades: BacktestTrade[];
}

export interface BacktestOptions {
  days: number;
  tuning?: StrategyTuning;
  /**
   * Fraction of the replay window to cover, as [start, end] in 0..1. Used to
   * split history into a part settings are chosen on and a part they are
   * checked against, so a good result cannot just be a fitted one.
   */
  sample?: [number, number];
}

/** Candles per calendar day for each timeframe, used to size the download. */
const BARS_PER_DAY: Record<TimeframeRole, number> = {
  entry: 1440,
  setup: 288,
  direction: 96,
  context: 24,
};

/** Per-role download ceiling, so one run never turns into hundreds of requests. */
const MAX_BARS: Record<TimeframeRole, number> = {
  entry: 30000,
  setup: 8000,
  direction: 3000,
  context: 1000,
};

export interface BacktestData {
  decimals: number;
  candles: Record<TimeframeRole, Candle[]>;
}

/** Downloads every timeframe needed to replay `days` of history. */
export async function loadBacktestData(
  instrument: InstrumentConfig,
  days: number,
): Promise<BacktestData> {
  const depth = Object.fromEntries(
    (Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]).map((role) => [
      role,
      Math.min(MAX_BARS[role], CANDLE_DEPTH[role] + Math.ceil(days * BARS_PER_DAY[role])),
    ]),
  ) as Record<TimeframeRole, number>;

  const [market, raw] = await Promise.all([
    capital.getMarket(instrument.epic),
    capital.getCandlesForRoles(instrument.epic, TIMEFRAME_ROLES, depth),
  ]);

  const candles = Object.fromEntries(
    (Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]).map((role) => [
      role,
      toCandles(raw[role], TIMEFRAME_ROLES[role]),
    ]),
  ) as Record<TimeframeRole, Candle[]>;

  return { decimals: market.snapshot.decimalPlacesFactor, candles };
}

/**
 * Replays the live logic bar by bar over historical candles.
 *
 * Nothing the strategy sees at bar *t* comes from after *t*: every timeframe is
 * sliced to candles that had already closed, swing detection only uses pivots
 * confirmed by then, and fills pay the spread that was actually quoted.
 */
export function replay(
  instrument: InstrumentConfig,
  { decimals, candles }: BacktestData,
  { days, tuning = DEFAULT_TUNING, sample = [0, 1] }: BacktestOptions,
): BacktestResult {
  const entryCandles = candles.entry;
  const barMs = TIMEFRAME_MS[TIMEFRAME_ROLES.entry];
  const maxHoldBars = Math.ceil((tuning.maxHoldMinutes * 60_000) / barMs);
  const windowStart = Math.max(
    CANDLE_DEPTH.entry,
    entryCandles.length - Math.ceil(days * BARS_PER_DAY.entry),
  );
  const span = entryCandles.length - windowStart;
  const start = windowStart + Math.floor(span * sample[0]);
  const end = windowStart + Math.floor(span * sample[1]);

  const trades: BacktestTrade[] = [];
  let barsTested = 0;
  let nextEligibleBar = start;

  for (let i = start; i < end - 1; i += 1) {
    if (i < nextEligibleBar) continue;
    barsTested += 1;

    const now = entryCandles[i].closeTime;
    const bar = entryCandles[i];
    const context = buildContext({
      instrumentId: instrument.id,
      candles: {
        context: window(closedBefore(candles.context, now), CANDLE_DEPTH.context),
        direction: window(closedBefore(candles.direction, now), CANDLE_DEPTH.direction),
        setup: window(closedBefore(candles.setup, now), CANDLE_DEPTH.setup),
        entry: window(entryCandles.slice(0, i + 1), CANDLE_DEPTH.entry),
      },
      price: bar.close,
      bid: bar.close - bar.spread / 2,
      ask: bar.close + bar.spread / 2,
      spread: bar.spread,
      decimals,
      marketStatus: 'TRADEABLE',
      now,
    });
    if (!context) continue;

    const decision = decide(context, tuning);
    if (decision.type === 'WAIT' || !decision.plan || !decision.strategy) continue;

    const trade = simulate(
      decision.strategy,
      decision.type,
      decision.plan,
      decision.score,
      entryCandles,
      i,
      maxHoldBars,
      tuning.exit,
      context.views.entry.atr,
    );
    if (!trade) continue;

    trades.push(trade);
    const exitIndex = i + Math.round(trade.holdMinutes * 60_000 / barMs);
    nextEligibleBar = exitIndex + tuning.cooldownBars;
  }

  return summarise(instrument, entryCandles, start, end, barsTested, trades);
}

/** Keeps the analysis window bounded so every bar costs the same to evaluate. */
const window = (series: Candle[], size: number): Candle[] =>
  series.length > size ? series.slice(-size) : series;

/**
 * Walks a position forward minute by minute under the configured exit policy.
 *
 * Within a bar the stop is always checked before the target: when one candle
 * spans both, the pessimistic reading is the only honest one, since OHLC data
 * cannot say which came first.
 */
function simulate(
  strategy: StrategyKey,
  direction: 'LONG' | 'SHORT',
  plan: TradePlan,
  score: number,
  candles: Candle[],
  signalIndex: number,
  maxHoldBars: number,
  exit: ExitPolicy,
  entryAtr: number,
): BacktestTrade | null {
  const isLong = direction === 'LONG';
  const s = isLong ? 1 : -1;
  const spread = candles[signalIndex].spread;
  // Filled at the signal bar's close, paying half the spread on the way in.
  const entry = plan.entry + (s * spread) / 2;
  const risk = Math.abs(entry - plan.stopLoss);
  if (risk <= 0) return null;

  let stop = plan.stopLoss;
  let best = entry;
  /** Fraction of the position still open. */
  let open = 1;
  /** Result already banked by a partial exit, in R. */
  let banked = 0;
  let scaledOut = false;

  const rOf = (exitPrice: number) => (s * (exitPrice - entry)) / risk;
  const lastIndex = Math.min(candles.length - 1, signalIndex + maxHoldBars);

  for (let i = signalIndex + 1; i <= lastIndex; i += 1) {
    const bar = candles[i];

    if (isLong ? bar.low <= stop : bar.high >= stop) {
      const total = banked + open * rOf(stop);
      return build(stop, total > 0 ? 'WIN' : 'LOSS', bar.closeTime, i, total);
    }

    const targetHit = isLong ? bar.high >= plan.takeProfit : bar.low <= plan.takeProfit;
    if (targetHit) {
      if (!exit.scaleOut || plan.takeProfit2 === null) {
        return build(plan.takeProfit, 'WIN', bar.closeTime, i, banked + open * rOf(plan.takeProfit));
      }
      if (!scaledOut) {
        // Half off at the first target; the rest rides with a free stop.
        banked += 0.5 * rOf(plan.takeProfit);
        open = 0.5;
        scaledOut = true;
        stop = isLong ? Math.max(stop, entry) : Math.min(stop, entry);
      }
    }

    if (scaledOut && plan.takeProfit2 !== null) {
      const secondHit = isLong ? bar.high >= plan.takeProfit2 : bar.low <= plan.takeProfit2;
      if (secondHit) {
        const total = banked + open * rOf(plan.takeProfit2);
        return build(plan.takeProfit2, 'WIN', bar.closeTime, i, total);
      }
    }

    best = isLong ? Math.max(best, bar.high) : Math.min(best, bar.low);
    const progress = (s * (best - entry)) / risk;

    if (exit.breakEvenAtR !== null && progress >= exit.breakEvenAtR) {
      stop = isLong ? Math.max(stop, entry) : Math.min(stop, entry);
    }
    if (exit.trailAtr !== null && progress > 0) {
      const trailed = best - s * exit.trailAtr * entryAtr;
      stop = isLong ? Math.max(stop, trailed) : Math.min(stop, trailed);
    }
  }

  const final = candles[lastIndex];
  const total = banked + open * rOf(final.close);
  return build(final.close, 'TIMEOUT', final.closeTime, lastIndex, total);

  function build(
    exitPrice: number,
    outcome: BacktestTrade['outcome'],
    closedAt: number,
    exitIndex: number,
    resultR: number,
  ): BacktestTrade {
    return {
      strategy,
      direction,
      score,
      openedAt: candles[signalIndex].closeTime,
      closedAt,
      entry,
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit,
      plannedRiskReward: plan.riskReward,
      exitPrice,
      outcome,
      r: Number(resultR.toFixed(3)),
      holdMinutes: (exitIndex - signalIndex) * (TIMEFRAME_MS[TIMEFRAME_ROLES.entry] / 60_000),
    };
  }
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

function summarise(
  instrument: InstrumentConfig,
  entryCandles: Candle[],
  start: number,
  end: number,
  barsTested: number,
  trades: BacktestTrade[],
): BacktestResult {
  const wins = trades.filter((trade) => trade.r > 0);
  const losses = trades.filter((trade) => trade.r <= 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.r, 0);
  const grossLoss = losses.reduce((sum, trade) => sum - trade.r, 0);

  const strategies = [...new Set(trades.map((trade) => trade.strategy))];
  const byStrategy = strategies
    .map((strategy) => {
      const subset = trades.filter((trade) => trade.strategy === strategy);
      const subsetWins = subset.filter((trade) => trade.r > 0).length;
      return {
        strategy,
        signals: subset.length,
        wins: subsetWins,
        losses: subset.length - subsetWins,
        winRate: Number(((subsetWins / subset.length) * 100).toFixed(1)),
        avgRiskReward: Number(mean(subset.map((t) => t.plannedRiskReward)).toFixed(2)),
        totalR: Number(subset.reduce((sum, t) => sum + t.r, 0).toFixed(2)),
        expectancy: Number(mean(subset.map((t) => t.r)).toFixed(3)),
      };
    })
    .sort((a, b) => b.totalR - a.totalR);

  return {
    instrumentId: instrument.id,
    label: instrument.label,
    from: entryCandles[start]?.time ?? 0,
    to: entryCandles[end - 1]?.closeTime ?? 0,
    barsTested,
    signals: trades.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: trades.filter((trade) => trade.outcome === 'TIMEOUT').length,
    winRate: trades.length === 0 ? 0 : Number(((wins.length / trades.length) * 100).toFixed(1)),
    avgRiskReward: Number(mean(trades.map((t) => t.plannedRiskReward)).toFixed(2)),
    avgScore: Math.round(mean(trades.map((t) => t.score))),
    avgHoldMinutes: Number(mean(trades.map((t) => t.holdMinutes)).toFixed(1)),
    totalR: Number(trades.reduce((sum, trade) => sum + trade.r, 0).toFixed(2)),
    profitFactor: grossLoss === 0 ? null : Number((grossProfit / grossLoss).toFixed(2)),
    expectancy: Number(mean(trades.map((t) => t.r)).toFixed(3)),
    byStrategy,
    trades,
  };
}

/** Convenience wrapper: download the history, then replay it once. */
export async function runBacktest(
  instrument: InstrumentConfig,
  options: BacktestOptions,
): Promise<BacktestResult> {
  const data = await loadBacktestData(instrument, options.days);
  return replay(instrument, data, options);
}
