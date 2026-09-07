import { INSTRUMENTS, type InstrumentConfig } from '@/lib/config';
import { recordSignal, resolveOpenSignals } from '@/lib/db';
import { analyseIntraday } from '@/lib/intraday';
import { getCandles } from '@/lib/market/candleCache';
import { getNewsPulse } from '@/lib/news';
import { getQuotes, type Quote } from '@/lib/quotes';
import { buildContext, decide, type Signal } from '@/lib/strategy';

/**
 * Produces the current signal for one instrument and files it in the history.
 *
 * Both inputs are cached upstream: quotes for a fraction of a second, candles
 * until a new one-minute bar closes. That keeps this cheap enough to run on
 * every poll, so the plan is always priced off the latest quote.
 */
export async function analyseInstrument(
  instrument: InstrumentConfig,
  quote: Quote | undefined,
): Promise<Signal> {
  const [candles, news] = await Promise.all([getCandles(instrument), getNewsPulse(instrument)]);
  const now = Date.now();
  const lastCandle = candles.entry[candles.entry.length - 1];

  const price = quote?.price || lastCandle?.close || 0;
  const spread = quote?.spread ?? lastCandle?.spread ?? 0;
  const decimals = quote?.decimals ?? 2;
  const marketStatus = quote?.marketStatus ?? 'CLOSED';

  resolveOpenSignals(instrument.id, 'scalp', candles.entry, now);

  const base = {
    instrumentId: instrument.id,
    epic: instrument.epic,
    label: instrument.label,
    horizon: 'scalp' as const,
    price,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    spread,
    decimals,
    marketStatus,
    updatedAt: now,
  };

  const context = buildContext({
    instrumentId: instrument.id,
    candles,
    price,
    bid: base.bid,
    ask: base.ask,
    spread,
    decimals,
    marketStatus,
    now,
    news,
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
      news,
      plan: null,
      reasons: ['The feed has not returned enough candles for a reliable read'],
      blockedBy: 'Not enough price history yet',
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
    news,
    plan: decision.plan,
    reasons: decision.reasons,
    blockedBy: decision.blockedBy,
  };

  recordSignal(signal);
  return signal;
}

/**
 * The whole board: each market read on both horizons, priced by one quote call.
 *
 * Ordered so the two scalping cards come first and the two hour-scale ones
 * follow, which is how the dashboard lays them out.
 */
export async function analyseAllInstruments(): Promise<Signal[]> {
  const quotes = await getQuotes();
  const byId = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
  const now = Date.now();

  const [scalps, intraday] = await Promise.all([
    Promise.all(
      INSTRUMENTS.map((instrument) => analyseInstrument(instrument, byId.get(instrument.id))),
    ),
    Promise.all(
      INSTRUMENTS.map(async (instrument) => {
        // The 15-minute frame is already loaded for the minute-scale engine.
        const candles = (await getCandles(instrument)).direction;
        resolveOpenSignals(instrument.id, 'intraday', candles, now);
        const signal = analyseIntraday(instrument, candles, byId.get(instrument.id), now);
        recordSignal(signal);
        return signal;
      }),
    ),
  ]);

  return [...scalps, ...intraday];
}
