import { INDICATORS, TIMEFRAME_LABEL, TIMEFRAME_ROLES, type TimeframeRole } from '@/lib/config';
import {
  atr as atrSeries,
  buildLevels,
  ema,
  findPivots,
  lastValue,
  median,
  rsi as rsiSeries,
  type Pivot,
} from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import type { Structure, TimeframeView, Views } from './types';

/** Enough candles for the slowest moving average plus a little structure. */
const MIN_CANDLES = INDICATORS.emaSlow + INDICATORS.atrPeriod + 10;

/** Reduces a candle series to the indicator snapshot the strategies reason about. */
export function buildView(role: TimeframeRole, candles: Candle[]): TimeframeView | null {
  if (candles.length < MIN_CANDLES) return null;

  const closes = candles.map((candle) => candle.close);
  const ema9 = lastValue(ema(closes, INDICATORS.emaFast));
  const ema20 = lastValue(ema(closes, INDICATORS.emaMid));
  const ema50 = lastValue(ema(closes, INDICATORS.emaSlow));
  const rsi = lastValue(rsiSeries(closes, INDICATORS.rsiPeriod));

  const atrValues = atrSeries(candles, INDICATORS.atrPeriod);
  const atr = lastValue(atrValues);
  if (ema9 === null || ema20 === null || rsi === null || atr === null || atr <= 0) return null;

  const recentAtr = atrValues
    .slice(-INDICATORS.volatilityLookback)
    .filter((value): value is number => value !== null);
  const baselineAtr = median(recentAtr);

  const close = closes[closes.length - 1];
  const levelWindow = candles.slice(-INDICATORS.levelLookback);
  const pivots = findPivots(levelWindow, INDICATORS.swingLookback);
  const swingHighs = pivots.filter((pivot) => pivot.kind === 'high');
  const swingLows = pivots.filter((pivot) => pivot.kind === 'low');

  return {
    role,
    timeframe: TIMEFRAME_ROLES[role],
    label: TIMEFRAME_LABEL[TIMEFRAME_ROLES[role]],
    candles,
    close,
    ema9,
    ema20,
    ema50,
    rsi,
    atr,
    atrPercent: (atr / close) * 100,
    atrRatio: baselineAtr > 0 ? atr / baselineAtr : 1,
    levels: buildLevels(pivots, atr * 0.5, levelWindow.length),
    swingHighs,
    swingLows,
    structure: readStructure(swingHighs, swingLows),
  };
}

/** Higher highs and higher lows mean an uptrend; the mirror image, a downtrend. */
function readStructure(highs: Pivot[], lows: Pivot[]): Structure {
  if (highs.length < 2 || lows.length < 2) return 'range';
  const [previousHigh, lastHigh] = highs.slice(-2);
  const [previousLow, lastLow] = lows.slice(-2);
  if (lastHigh.price > previousHigh.price && lastLow.price > previousLow.price) return 'up';
  if (lastHigh.price < previousHigh.price && lastLow.price < previousLow.price) return 'down';
  return 'range';
}

/** Builds every timeframe view; null when any of them lacks history. */
export function buildViews(candlesByRole: Record<TimeframeRole, Candle[]>): Views | null {
  const views = {} as Views;
  for (const role of Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]) {
    const view = buildView(role, candlesByRole[role]);
    if (!view) return null;
    views[role] = view;
  }
  return views;
}
