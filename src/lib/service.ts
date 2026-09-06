import { capital } from '@/lib/capital/client';
import {
  CANDLE_DEPTH,
  INSTRUMENTS,
  TIMEFRAME_ROLES,
  type InstrumentConfig,
  type TimeframeRole,
} from '@/lib/config';
import { recordSignal, resolveOpenSignals } from '@/lib/db';
import { toCandles, type Candle } from '@/lib/market/candles';
import { buildContext, decide, type Signal } from '@/lib/strategy';

/**
 * Produces the current signal for one instrument and files it in the history.
 *
 * Everything downstream of the API lives here: fetch, analyse, decide, then
 * settle any earlier signal against the candles that have printed since.
 */
export async function analyseInstrument(instrument: InstrumentConfig): Promise<Signal> {
  const [market, raw] = await Promise.all([
    capital.getMarket(instrument.epic),
    capital.getCandlesForRoles(instrument.epic, TIMEFRAME_ROLES, CANDLE_DEPTH),
  ]);

  const now = Date.now();
  const candles = Object.fromEntries(
    (Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]).map((role) => [
      role,
      toCandles(raw[role], TIMEFRAME_ROLES[role], now),
    ]),
  ) as Record<TimeframeRole, Candle[]>;

  const { bid, offer, decimalPlacesFactor: decimals, marketStatus } = market.snapshot;
  const lastCandle = candles.entry[candles.entry.length - 1];
  const price = bid !== null && offer !== null ? (bid + offer) / 2 : (lastCandle?.close ?? 0);
  const spread = bid !== null && offer !== null ? offer - bid : (lastCandle?.spread ?? 0);

  resolveOpenSignals(instrument.id, candles.entry, now);

  const base = {
    instrumentId: instrument.id,
    epic: instrument.epic,
    label: instrument.label,
    price,
    bid,
    ask: offer,
    spread,
    decimals,
    marketStatus,
    updatedAt: now,
  };

  const context = buildContext({
    instrumentId: instrument.id,
    candles,
    price,
    bid,
    ask: offer,
    spread,
    decimals,
    marketStatus,
    now,
  });

  if (!context) {
    return {
      ...base,
      type: 'WAIT',
      score: 0,
      strategy: null,
      strategyLabel: null,
      regime: 'CHOP',
      vwap: null,
      plan: null,
      reasons: ['The feed has not returned enough candles for a reliable read'],
      blockedBy: 'Insufficient data',
    };
  }

  const decision = decide(context);
  const signal: Signal = {
    ...base,
    type: decision.type,
    score: decision.score,
    strategy: decision.strategy,
    strategyLabel: decision.strategyLabel,
    regime: context.regime,
    vwap: context.vwap,
    plan: decision.plan,
    reasons: decision.reasons,
    blockedBy: decision.blockedBy,
  };

  recordSignal(signal);
  return signal;
}

/** Current signals for every configured instrument. */
export function analyseAllInstruments(): Promise<Signal[]> {
  return Promise.all(INSTRUMENTS.map(analyseInstrument));
}
