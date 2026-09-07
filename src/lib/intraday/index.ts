import { INTRADAY, type InstrumentConfig } from '@/lib/config';
import { atr as atrSeries, ema, lastValue, rsi as rsiSeries } from '@/lib/indicators';
import type { Candle } from '@/lib/market/candles';
import type { Quote } from '@/lib/quotes';
import { STANDING_ASIDE } from '@/lib/strategy';
import type { Signal } from '@/lib/strategy/types';

/**
 * Hour-scale continuation on 15-minute candles.
 *
 * The measurement is the same three-part stretch the minute engine uses, but
 * the trade is taken *with* it rather than against it: over an hour, a market
 * that has just pushed hard tends to keep going, and the move is finally large
 * enough to clear the spread. The signal bar must also have closed in the
 * trade's direction, so a stretch that is already unwinding is skipped.
 */
export interface IntradayRead {
  /** Positive means the market pushed up, so the trade is a long. */
  stretch: number;
  atr: number;
  rsi: number;
  changePercent: number;
  /** True when the last bar closed in the direction of the stretch. */
  confirmed: boolean;
}

export function readIntraday(candles: Candle[]): IntradayRead | null {
  if (candles.length < INTRADAY.lookback + 40) return null;

  const closes = candles.map((candle) => candle.close);
  const atr = lastValue(atrSeries(candles, 14));
  const ema20 = lastValue(ema(closes, 20));
  const rsi = lastValue(rsiSeries(closes, 14));
  if (!atr || atr <= 0 || ema20 === null || rsi === null) return null;

  const last = candles[candles.length - 1];
  const close = last.close;
  const past = closes[closes.length - 1 - INTRADAY.lookback];
  if (past <= 0) return null;

  const stretch = ((close - past) / atr + (rsi - 50) / 20 + (close - ema20) / atr) / 3;
  const confirmed = stretch > 0 ? close > last.open : close < last.open;

  return { stretch, atr, rsi, changePercent: ((close - past) / past) * 100, confirmed };
}

const HOLD_MINUTES = INTRADAY.holdBars * 15;

/** Turns the 15-minute read and the live quote into a signal for the board. */
export function analyseIntraday(
  instrument: InstrumentConfig,
  candles: Candle[],
  quote: Quote | undefined,
  now: number,
): Signal {
  const read = readIntraday(candles);
  const last = candles[candles.length - 1];
  const decimals = quote?.decimals ?? 2;
  const price = quote?.price || last?.close || 0;
  const round = (value: number) => Number(value.toFixed(decimals));

  const base = {
    instrumentId: instrument.id,
    epic: instrument.epic,
    label: instrument.label,
    horizon: 'intraday' as const,
    price,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    spread: quote?.spread ?? last?.spread ?? 0,
    decimals,
    marketStatus: quote?.marketStatus ?? 'CLOSED',
    vwap: null,
    news: null,
    regime: 'TREND' as const,
    strategy: null,
    strategyLabel: null,
    updatedAt: now,
  };

  const wait = (cause: string, reasons: string[] = []): Signal => ({
    ...base,
    type: 'WAIT',
    score: 0,
    plan: null,
    reasons,
    blockedBy: `${STANDING_ASIDE} ${cause}`,
  });

  if (!read) return wait('not enough 15m history yet');
  if (base.marketStatus !== 'TRADEABLE') {
    return wait(`market is ${base.marketStatus.toLowerCase().replace(/_/g, ' ')}`);
  }

  const strength = Math.abs(read.stretch);
  const move = read.changePercent;
  const context = [
    `${HOLD_MINUTES}m move ${move >= 0 ? '+' : ''}${move.toFixed(2)}%, push ${strength.toFixed(2)} of ${INTRADAY.threshold} needed`,
    `15m RSI ${read.rsi.toFixed(0)}`,
  ];

  if (strength < INTRADAY.threshold) return wait('the move is not strong enough to join', context);
  if (!read.confirmed) return wait('the last 15m candle closed against the move', context);

  const isLong = read.stretch > 0;
  const side = isLong ? 1 : -1;

  return {
    ...base,
    type: isLong ? 'LONG' : 'SHORT',
    score: Math.min(100, Math.round((strength / INTRADAY.scoreCeiling) * 100)),
    strategy: 'intraday-momentum',
    strategyLabel: 'Momentum',
    plan: {
      entryLow: round(price - 0.2 * read.atr),
      entryHigh: round(price + 0.2 * read.atr),
      entry: round(price),
      stopLoss: round(price - side * INTRADAY.stopAtr * read.atr),
      takeProfit: round(price + side * INTRADAY.targetAtr * read.atr),
      takeProfit2: null,
      riskReward: Number((INTRADAY.targetAtr / INTRADAY.stopAtr).toFixed(2)),
      stopReason: `Stop ${INTRADAY.stopAtr} x 15m ATR away, behind the noise of the move`,
      targetReason: `Target ${INTRADAY.targetAtr} x 15m ATR, the distance this push typically adds`,
    },
    reasons: [
      isLong
        ? `Pushed ${Math.abs(move).toFixed(2)}% over the last hour and closed on its highs`
        : `Dropped ${Math.abs(move).toFixed(2)}% over the last hour and closed on its lows`,
      `15m RSI ${read.rsi.toFixed(0)}, push ${strength.toFixed(2)}`,
      `Close after ${HOLD_MINUTES} minutes whether or not the target is reached`,
    ],
    blockedBy: null,
  };
}
