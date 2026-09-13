import { INTRADAY, intradayTuning, type IntradayTuning, type InstrumentConfig } from '@/lib/config';
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

export function readIntraday(candles: Candle[], tuning: IntradayTuning = INTRADAY): IntradayRead | null {
  if (candles.length < tuning.lookback + 40) return null;

  const closes = candles.map((candle) => candle.close);
  const atr = lastValue(atrSeries(candles, 14));
  const ema20 = lastValue(ema(closes, 20));
  const rsi = lastValue(rsiSeries(closes, 14));
  if (!atr || atr <= 0 || ema20 === null || rsi === null) return null;

  const last = candles[candles.length - 1];
  const close = last.close;
  const past = closes[closes.length - 1 - tuning.lookback];
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
  tuning: IntradayTuning = intradayTuning(instrument.id),
): Signal {
  const read = readIntraday(candles, tuning);
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

  const wait = (code: string, cause: string, reasons: string[] = []): Signal => ({
    ...base,
    type: 'WAIT',
    score: 0,
    plan: null,
    reasons,
    blockedBy: `${STANDING_ASIDE} ${cause}`,
    rejections: [{ code, detail: cause }],
  });

  if (!read) return wait('history', 'пока мало истории на 15м');
  if (base.marketStatus !== 'TRADEABLE') {
    return wait('market_closed', 'рынок закрыт');
  }
  if (!quote || quote.bid === null || quote.ask === null ||
      !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) ||
      quote.bid <= 0 || quote.ask < quote.bid) {
    return wait('quote_missing', 'нет корректной цены покупки и продажи');
  }

  const strength = Math.abs(read.stretch);
  const move = read.changePercent;
  const context = [
    `Движение за ${tuning.lookback * 15} мин ${move >= 0 ? '+' : ''}${move.toFixed(2)}%, сила ${strength.toFixed(2)} из ${tuning.threshold} нужных`,
    `RSI на 15м ${read.rsi.toFixed(0)}`,
  ];

  if (strength < tuning.threshold) return wait('strength', 'движение слишком слабое, чтобы входить', context);
  if (!read.confirmed) return wait('confirmation', 'последняя свеча 15м закрылась против движения', context);

  const isLong = read.stretch > 0;
  const side = isLong ? 1 : -1;
  const fill = isLong ? quote.ask : quote.bid;
  const entry = round(fill);
  const stopLoss = round(fill - side * tuning.stopAtr * read.atr);
  const takeProfit = round(fill + side * tuning.targetAtr * read.atr);
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0 || takeProfit === entry) return wait('plan', 'уровни совпали после округления');

  return {
    ...base,
    type: isLong ? 'LONG' : 'SHORT',
    score: Math.min(100, Math.round((strength / tuning.scoreCeiling) * 100)),
    strategy: 'intraday-momentum',
    strategyLabel: 'Импульс внутри дня',
    plan: {
      entryLow: round(fill - 0.2 * read.atr),
      entryHigh: round(fill + 0.2 * read.atr),
      entry,
      stopLoss,
      takeProfit,
      takeProfit2: null,
      riskReward: Number((Math.abs(takeProfit - entry) / risk).toFixed(2)),
      stopReason: `Стоп в ${tuning.stopAtr} ATR на 15м, за шумом движения`,
      targetReason: `Цель в ${tuning.targetAtr} ATR на 15м`,
    },
    reasons: [
      isLong
        ? `Вырос на ${Math.abs(move).toFixed(2)}% за ${tuning.lookback * 15} мин, последняя свеча растущая`
        : `Упал на ${Math.abs(move).toFixed(2)}% за ${tuning.lookback * 15} мин, последняя свеча падающая`,
      `RSI на 15м ${read.rsi.toFixed(0)}, сила ${strength.toFixed(2)}`,
      `Закрытие через ${HOLD_MINUTES} минут, дошла цель или нет`,
    ],
    blockedBy: null,
  };
}
