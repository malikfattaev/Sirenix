import type { InstrumentConfig } from '@/lib/config';
import { recordSignal, resolveOpenSignals } from '@/lib/db';
import { recordSkip } from '@/lib/db/skips';
import { withPosition } from '@/lib/position';
import { activeInstruments, activeTuning, horizonsFor } from '@/lib/settings';
import { analyseIntraday } from '@/lib/intraday';
import { getCandles } from '@/lib/market/candleCache';
import { getNewsPulse } from '@/lib/news';
import { getQuotes, type Quote } from '@/lib/quotes';
import { buildContext, decide, STANDING_ASIDE, type Signal } from '@/lib/strategy';

/**
 * Refuses to issue anything on a price that cannot be traded on.
 *
 * Two different reasons a price stops moving, and they must not be confused. A
 * sleeping market is normal and says when it wakes; a market whose session is
 * running while the price stands still is a feed to distrust. Neither is
 * something to open a trade on. A signal already running is left alone, so it
 * still shows and can be managed to its stop or its target.
 */
function tradable(signal: Signal, quote: Quote | undefined): Signal {
  if (!quote || (quote.open && !quote.stale)) return signal;

  const cause = quote.open
    ? `цена не обновляется ${Math.round(quote.age / 60_000)} мин, торговать по ней нельзя`
    // The opening time is rendered on the card instead of written in here: it
    // is a wall clock, and the server's is not the one the reader is looking at.
    : 'рынок спит, торгов сейчас нет';

  return {
    ...signal,
    type: 'WAIT',
    score: 0,
    strategy: null,
    strategyLabel: null,
    plan: null,
    blockedBy: `${STANDING_ASIDE} ${cause}`,
    rejections: [{ code: quote.open ? 'stale_quote' : 'market_closed', detail: cause }],
  };
}

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

  resolveOpenSignals(instrument.id, 'scalp', candles.entry, now, quote);

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
    const signal: Signal = {
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
      rejections: [{ code: 'history', detail: 'Not enough price history yet' }],
    };
    recordSkip(signal);
    return signal;
  }

  const decision = decide(context, activeTuning());

  const signal = withPosition(
    tradable(
      {
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
        rejections: decision.rejections,
      },
      quote,
    ),
  );

  recordSignal(signal);
  recordSkip(signal);
  return signal;
}

/**
 * The whole board: each market on the horizons it runs, priced by one quote call.
 *
 * Ordered market by market, each with its horizons in turn, so gold takes the
 * first row of the board and Brent the second.
 */
export async function analyseAllInstruments(): Promise<Signal[]> {
  const quotes = await getQuotes();
  const byId = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
  const now = Date.now();

  const instruments = activeInstruments();

  const board = await Promise.all(
    instruments.map(async (instrument) => {
      const quote = byId.get(instrument.id);
      const horizons = horizonsFor(instrument.id);

      const scalp = horizons.includes('scalp')
        ? await analyseInstrument(instrument, quote)
        : null;

      let intraday: Signal | null = null;
      if (horizons.includes('intraday')) {
        // The 15-minute frame is already loaded for the minute-scale engine.
        const candles = (await getCandles(instrument)).direction;
        resolveOpenSignals(instrument.id, 'intraday', candles, now, quote);
        intraday = withPosition(
          tradable(analyseIntraday(instrument, candles, quote, now), quote),
        );
        recordSignal(intraday);
        recordSkip(intraday);
      }

      return [scalp, intraday].filter((signal) => signal !== null);
    }),
  );

  // Grouped by market rather than by horizon, so a market keeps its own row on
  // the two-column board instead of being split across two of them.
  return board.flat();
}
