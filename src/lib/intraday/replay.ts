import { CANDLE_DEPTH, INTRADAY, POSITION, TIMEFRAME_MS, type InstrumentConfig, type IntradayTuning } from '@/lib/config';
import { analyseIntraday } from './index';
import type { Candle } from '@/lib/market/candles';
import type { Quote } from '@/lib/quotes';
import type { Direction, TradePlan } from '@/lib/strategy/types';

export interface IntradayTrade {
  openedAt: number;
  closedAt: number;
  r: number;
  status: 'WIN' | 'LOSS' | 'EXPIRED';
}

/** Candle spread approximates the exit side. Stop first if both levels are touched. */
export function candleExit(plan: TradePlan, direction: Direction, candle: Candle) {
  const side = direction === 'LONG' ? 1 : -1;
  const low = candle.low - side * candle.spread / 2;
  const high = candle.high - side * candle.spread / 2;
  const open = candle.open - side * candle.spread / 2;
  if (side === 1 ? low <= plan.stopLoss : high >= plan.stopLoss) {
    return { status: 'LOSS' as const, price: side === 1 ? Math.min(open, plan.stopLoss) : Math.max(open, plan.stopLoss) };
  }
  if (side === 1 ? high >= plan.takeProfit : low <= plan.takeProfit) {
    return { status: 'WIN' as const, price: plan.takeProfit };
  }
  return null;
}

/** Closed-bar research approximation, not a tick-for-tick replay of live execution. */
export function replayIntraday(instrument: InstrumentConfig, candles: Candle[], tuning: IntradayTuning): IntradayTrade[] {
  const trades: IntradayTrade[] = [];
  let nextAt = 0;
  let lossCount = 0;
  let lastStopAt = 0;
  let lastCloseAt = 0;
  for (let i = CANDLE_DEPTH.direction - 1; i < candles.length - 1; i++) {
    const candle = candles[i];
    const now = candle.closeTime;
    if (now < nextAt || now < lastStopAt + POSITION.lossCooldownMs.intraday ||
        (lossCount >= POSITION.maxLossStreak && now < lastCloseAt + POSITION.streakPauseMs.intraday)) continue;
    const expiresAt = now + INTRADAY.holdBars * TIMEFRAME_MS.MINUTE_15;
    const lastIndex = candles.findIndex((c, index) => index > i && c.closeTime >= expiresAt);
    if (lastIndex < 0) break;
    // A missing bar/session gap prevents observing the scheduled exit reliably.
    const future = candles.slice(i + 1, lastIndex + 1);
    if (future[0].time !== now || future.some((c, j) => j > 0 && c.time !== future[j - 1].closeTime)) continue;
    const quote: Quote = {
      instrumentId: instrument.id, price: candle.close,
      bid: candle.close - candle.spread / 2, ask: candle.close + candle.spread / 2,
      spread: candle.spread, decimals: 2, marketStatus: 'TRADEABLE', changePercent: 0,
      updatedAt: now, source: 'snapshot', age: 0, stale: false, open: true, closesAt: null, opensAt: null,
    };
    const signal = analyseIntraday(instrument, candles.slice(i + 1 - CANDLE_DEPTH.direction, i + 1), quote, now, tuning);
    if (signal.type === 'WAIT' || !signal.plan) continue;
    const side = signal.type === 'LONG' ? 1 : -1;
    const last = future[future.length - 1];
    let exit = { status: 'EXPIRED' as IntradayTrade['status'], price: last.close - side * last.spread / 2, at: last.closeTime };
    for (const bar of future) {
      const hit = candleExit(signal.plan, signal.type, bar);
      if (hit) { exit = { ...hit, at: bar.closeTime }; break; }
    }
    const r = side * (exit.price - signal.plan.entry) / Math.abs(signal.plan.entry - signal.plan.stopLoss);
    trades.push({ openedAt: now, closedAt: exit.at, r, status: exit.status });
    nextAt = exit.at;
    lastCloseAt = exit.at;
    lossCount = r < 0 ? lossCount + 1 : 0;
    // Matches the current live policy: the short cooldown applies to stopped trades.
    if (exit.status === 'LOSS') lastStopAt = exit.at;
  }
  return trades;
}

export function intradayStats(trades: IntradayTrade[]) {
  let totalR = 0;
  let peak = 0;
  let drawdownR = 0;
  for (const trade of trades) {
    totalR += trade.r;
    peak = Math.max(peak, totalR);
    drawdownR = Math.max(drawdownR, peak - totalR);
  }
  return { trades: trades.length, winPercent: trades.length ? 100 * trades.filter((t) => t.r > 0).length / trades.length : 0,
    totalR, averageR: trades.length ? totalR / trades.length : 0, drawdownR };
}
