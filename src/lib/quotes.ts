import { capital } from '@/lib/capital/client';
import { ALL_INSTRUMENTS, QUOTE_CACHE_MS, QUOTE_STALE_MS } from '@/lib/config';
import { marketHours } from '@/lib/market/hours';
import { latestTick, watch } from '@/lib/market/stream';

/** The live price data the dashboard refreshes every second. */
export interface Quote {
  instrumentId: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number;
  decimals: number;
  marketStatus: string;
  changePercent: number;
  updatedAt: number;
  /**
   * `stream` is a tick off the socket, the same feed the platform draws.
   * `snapshot` is the REST reading, which is whatever the server last wrote
   * down and can be minutes behind on a market that still reads TRADEABLE.
   */
  source: 'stream' | 'snapshot';
  /** Milliseconds since the price last moved, so the page can say when it is old. */
  age: number;
  /**
   * True only when the market should be trading and the price has stood still
   * anyway. A closed market is not stale, it is closed.
   */
  stale: boolean;
  /** Whether the instrument's own schedule says a session is running. */
  open: boolean;
  /** End of the running session, or start of the next one. */
  closesAt: number | null;
  opensAt: number | null;
}

interface CacheEntry {
  at: number;
  quotes: Quote[];
}

let cache: CacheEntry | null = null;
let inFlight: Promise<Quote[]> | null = null;

/**
 * When each market's price was last seen to move.
 *
 * The age of a snapshot cannot be read off the response without trusting the
 * server's clock and its timezone, so it is measured here instead: the moment a
 * bid or ask differs from the one before it. That understates the age of a
 * price that was already old when the process started, and is right from then
 * on, which is the honest way round.
 */
const movedAt = new Map<string, { bid: number; ask: number; at: number }>();

function ageOf(instrumentId: string, bid: number | null, ask: number | null, now: number): number {
  if (bid === null || ask === null) return 0;
  const previous = movedAt.get(instrumentId);
  if (!previous || previous.bid !== bid || previous.ask !== ask) {
    movedAt.set(instrumentId, { bid, ask, at: now });
    return 0;
  }
  return now - previous.at;
}

/**
 * Current quotes for every instrument.
 *
 * The snapshot request is cached for a fraction of a second and shared between
 * concurrent callers, but the price itself is taken from the socket every time,
 * so the number on screen is never older than the last tick even when the
 * snapshot behind it is a second old.
 */
export async function getQuotes(): Promise<Quote[]> {
  watch(ALL_INSTRUMENTS.map((instrument) => instrument.epic));

  if (cache && Date.now() - cache.at < QUOTE_CACHE_MS) return withTicks(cache.quotes);

  inFlight ??= fetchQuotes()
    .then((quotes) => {
      cache = { at: Date.now(), quotes };
      return quotes;
    })
    .finally(() => {
      inFlight = null;
    });

  return withTicks(await inFlight);
}

/** Replaces the snapshot price with the live tick wherever there is one. */
function withTicks(quotes: Quote[]): Quote[] {
  const now = Date.now();

  return quotes.map((quote) => {
    const instrument = ALL_INSTRUMENTS.find((entry) => entry.id === quote.instrumentId);
    const tick = instrument ? latestTick(instrument.epic) : null;

    const priced = tick
      ? {
          ...quote,
          price: (tick.bid + tick.ask) / 2,
          bid: tick.bid,
          ask: tick.ask,
          spread: tick.ask - tick.bid,
          updatedAt: tick.at,
          source: 'stream' as const,
        }
      : quote;

    const age = ageOf(priced.instrumentId, priced.bid, priced.ask, now);
    return { ...priced, age, stale: priced.open && age > QUOTE_STALE_MS };
  });
}

async function fetchQuotes(): Promise<Quote[]> {
  const details = await capital.getMarkets(ALL_INSTRUMENTS.map((instrument) => instrument.epic));
  const now = Date.now();

  return ALL_INSTRUMENTS.flatMap((instrument) => {
    const market = details.find((entry) => entry.instrument.epic === instrument.epic);
    if (!market) return [];

    const { bid, offer, decimalPlacesFactor, marketStatus, percentageChange } = market.snapshot;
    const hasQuote = bid !== null && offer !== null;
    // `marketStatus` keeps saying TRADEABLE after a session ends, so the
    // instrument's own schedule is what decides whether it is open.
    const hours = marketHours(market.instrument.openingHours, now);
    return [
      {
        instrumentId: instrument.id,
        price: hasQuote ? (bid + offer) / 2 : 0,
        bid,
        ask: offer,
        spread: hasQuote ? offer - bid : 0,
        decimals: decimalPlacesFactor,
        marketStatus,
        changePercent: percentageChange,
        updatedAt: now,
        source: 'snapshot' as const,
        age: 0,
        stale: false,
        open: hours ? hours.open : marketStatus === 'TRADEABLE',
        closesAt: hours?.closesAt ?? null,
        opensAt: hours?.opensAt ?? null,
      },
    ];
  });
}
