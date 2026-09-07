import { SWING, type InstrumentConfig } from '@/lib/config';
import { atr as atrSeries, ema, lastValue, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import type { Quote } from '@/lib/quotes';
import type { Signal } from '@/lib/strategy/types';

/**
 * Daily mean reversion on equity indices.
 *
 * A sharp one-day move that leaves price stretched from its hourly mean tends
 * to be partly given back over the following day or two. The score is the
 * average of three views of that stretch, so no single indicator can trigger a
 * signal on its own, and it is symmetric: an index that has fallen hard is a
 * long, one that has run up is a short.
 */
export interface SwingRead {
  /** Positive means the market fell and is stretched, so the trade is a long. */
  score: number;
  atr: number;
  rsi: number;
  changePercent: number;
}

export function readSwing(candles: Candle[]): SwingRead | null {
  if (candles.length < SWING.lookbackHours + 60) return null;

  const closes = candles.map((candle) => candle.close);
  const atr = lastValue(atrSeries(candles, 14));
  const ema20 = lastValue(ema(closes, 20));
  const rsi = lastValue(rsiSeries(closes, 14));
  if (!atr || atr <= 0 || ema20 === null || rsi === null) return null;

  const close = closes[closes.length - 1];
  const past = closes[closes.length - 1 - SWING.lookbackHours];
  if (past <= 0) return null;

  const score = -((close - past) / atr + (rsi - 50) / 20 + (close - ema20) / atr) / 3;

  return { score, atr, rsi, changePercent: ((close - past) / past) * 100 };
}

/** Turns the hourly read and the live quote into a signal for the board. */
export function analyseSwing(
  instrument: InstrumentConfig,
  candles: Candle[],
  quote: Quote | undefined,
  now: number,
): Signal {
  const read = readSwing(candles);
  const last = candles[candles.length - 1];
  const decimals = quote?.decimals ?? 2;
  const price = quote?.price || last?.close || 0;
  const round = (value: number) => Number(value.toFixed(decimals));

  const base = {
    instrumentId: instrument.id,
    epic: instrument.epic,
    label: instrument.label,
    horizon: 'swing' as const,
    price,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    spread: quote?.spread ?? last?.spread ?? 0,
    decimals,
    marketStatus: quote?.marketStatus ?? 'CLOSED',
    vwap: null,
    news: null,
    regime: 'RANGE' as const,
    strategy: null,
    strategyLabel: null,
    updatedAt: now,
  };

  const wait = (blockedBy: string, reasons: string[] = []): Signal => ({
    ...base,
    type: 'WAIT',
    score: 0,
    plan: null,
    reasons,
    blockedBy,
  });

  if (!read) return wait('Not enough hourly history yet');
  if (base.marketStatus !== 'TRADEABLE') {
    return wait(`Market is ${base.marketStatus.toLowerCase().replace(/_/g, ' ')}`);
  }

  const stretch = Math.abs(read.score);
  const score = Math.min(100, Math.round((stretch / SWING.scoreCeiling) * 100));
  const move = read.changePercent;

  if (stretch < SWING.scoreThreshold) {
    return wait('Not stretched far enough to fade', [
      `24h move ${move >= 0 ? '+' : ''}${move.toFixed(2)}%, stretch ${stretch.toFixed(2)} of ${SWING.scoreThreshold} needed`,
      `Hourly RSI ${read.rsi.toFixed(0)}`,
    ]);
  }

  const isLong = read.score > 0;
  const side = isLong ? 1 : -1;

  return {
    ...base,
    type: isLong ? 'LONG' : 'SHORT',
    score,
    strategy: 'index-reversion',
    strategyLabel: 'Daily Reversion',
    plan: {
      entryLow: round(price - 0.15 * read.atr),
      entryHigh: round(price + 0.15 * read.atr),
      entry: round(price),
      stopLoss: round(price - side * SWING.stopAtr * read.atr),
      takeProfit: round(price + side * SWING.targetAtr * read.atr),
      takeProfit2: null,
      riskReward: Number((SWING.targetAtr / SWING.stopAtr).toFixed(2)),
      stopReason: `Stop ${SWING.stopAtr} x hourly ATR away, wide enough for the move to overshoot first`,
      targetReason: `Target ${SWING.targetAtr} x hourly ATR, the distance this fade typically covers`,
    },
    reasons: [
      isLong
        ? `Fell ${Math.abs(move).toFixed(2)}% over 24h and sits stretched below its hourly mean`
        : `Rose ${Math.abs(move).toFixed(2)}% over 24h and sits stretched above its hourly mean`,
      `Hourly RSI ${read.rsi.toFixed(0)}, stretch ${stretch.toFixed(2)}`,
      `Close after ${SWING.holdHours}h whether or not the target is reached`,
    ],
    blockedBy: null,
  };
}
