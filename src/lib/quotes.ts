import { capital } from '@/lib/capital/client';
import { INSTRUMENTS, QUOTE_CACHE_MS } from '@/lib/config';

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
}

interface CacheEntry {
  at: number;
  quotes: Quote[];
}

let cache: CacheEntry | null = null;
let inFlight: Promise<Quote[]> | null = null;

/**
 * Current quotes for every instrument, from a single upstream request.
 *
 * Results are cached for a fraction of a second and concurrent callers share
 * one request, so several open tabs polling once a second still add up to about
 * one call per second against the API.
 */
export function getQuotes(): Promise<Quote[]> {
  if (cache && Date.now() - cache.at < QUOTE_CACHE_MS) {
    return Promise.resolve(cache.quotes);
  }
  inFlight ??= fetchQuotes()
    .then((quotes) => {
      cache = { at: Date.now(), quotes };
      return quotes;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function fetchQuotes(): Promise<Quote[]> {
  const details = await capital.getMarkets(INSTRUMENTS.map((instrument) => instrument.epic));
  const now = Date.now();

  return INSTRUMENTS.flatMap((instrument) => {
    const market = details.find((entry) => entry.instrument.epic === instrument.epic);
    if (!market) return [];

    const { bid, offer, decimalPlacesFactor, marketStatus, percentageChange } = market.snapshot;
    const hasQuote = bid !== null && offer !== null;
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
      },
    ];
  });
}
