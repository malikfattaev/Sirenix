import { CANDLE_DEPTH, type Timeframe } from '@/lib/config';
import {
  CapitalApiError,
  type CapitalErrorBody,
  type CapitalMarketDetails,
  type CapitalPrice,
  type CapitalMarketsResponse,
  type CapitalPricesResponse,
} from './types';

const BASE_URLS = {
  live: 'https://api-capital.backend-capital.com',
  demo: 'https://demo-api-capital.backend-capital.com',
} as const;

/** Documented ceiling for a single /prices request. */
const MAX_CANDLES_PER_REQUEST = 1000;
/** Sessions expire after 10 minutes; renew early to avoid racing the boundary. */
const SESSION_TTL_MS = 8 * 60_000;
/** The API allows 10 requests/second; stay comfortably under it. */
const MIN_REQUEST_INTERVAL_MS = 130;
/** Backoff when the server rate-limits us anyway, e.g. under a heavy backtest. */
const RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_BACKOFF_MS = 1_500;

interface Session {
  cst: string;
  securityToken: string;
  createdAt: number;
}

interface Credentials {
  apiKey: string;
  identifier: string;
  password: string;
  baseUrl: string;
}

function readCredentials(): Credentials {
  const apiKey = process.env.CAPITAL_API_KEY;
  const identifier = process.env.CAPITAL_IDENTIFIER;
  const password = process.env.CAPITAL_API_PASSWORD;
  const environment = (process.env.CAPITAL_ENVIRONMENT ?? 'live').toLowerCase();

  const missing = [
    ['CAPITAL_API_KEY', apiKey],
    ['CAPITAL_IDENTIFIER', identifier],
    ['CAPITAL_API_PASSWORD', password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  if (environment !== 'live' && environment !== 'demo') {
    throw new Error(`CAPITAL_ENVIRONMENT must be "live" or "demo", got "${environment}"`);
  }

  return {
    apiKey: apiKey!,
    identifier: identifier!,
    password: password!,
    baseUrl: BASE_URLS[environment],
  };
}

/**
 * Thin, dependency-free wrapper around the Capital.com market-data endpoints.
 *
 * Responsibilities:
 *  - keeps a single authenticated session alive and renews it transparently;
 *  - serialises outgoing calls so the documented rate limit is never exceeded;
 *  - retries once when the server rejects a stale session.
 *
 * Read-only by design: no trading endpoint is reachable from here.
 */
class CapitalClient {
  private session: Session | null = null;
  private sessionPromise: Promise<Session> | null = null;
  private requestChain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  /** Serialises every outgoing call and spaces them out in time. */
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.requestChain.then(async () => {
      const waitFor = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
      if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
      this.lastRequestAt = Date.now();
      return task();
    });
    // Keep the chain alive even when a task rejects.
    this.requestChain = run.catch(() => undefined);
    return run;
  }

  private async openSession(): Promise<Session> {
    const { apiKey, identifier, password, baseUrl } = readCredentials();

    const response = await this.schedule(() =>
      fetch(`${baseUrl}/api/v1/session`, {
        method: 'POST',
        headers: { 'X-CAP-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        cache: 'no-store',
      }),
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as CapitalErrorBody;
      throw new CapitalApiError(
        `Capital.com login failed (${response.status})`,
        response.status,
        body.errorCode,
      );
    }

    const cst = response.headers.get('CST');
    const securityToken = response.headers.get('X-SECURITY-TOKEN');
    if (!cst || !securityToken) {
      throw new CapitalApiError('Capital.com login returned no session tokens', 500);
    }

    return { cst, securityToken, createdAt: Date.now() };
  }

  /** Returns a live session, opening or renewing one only when necessary. */
  private async getSession(forceRenew = false): Promise<Session> {
    if (forceRenew) {
      this.session = null;
      this.sessionPromise = null;
    }
    if (this.session && Date.now() - this.session.createdAt < SESSION_TTL_MS) {
      return this.session;
    }
    this.sessionPromise ??= this.openSession()
      .then((session) => {
        this.session = session;
        return session;
      })
      .finally(() => {
        this.sessionPromise = null;
      });
    return this.sessionPromise;
  }

  private async request<T>(path: string, retryOnAuthFailure = true, attempt = 0): Promise<T> {
    const { apiKey, baseUrl } = readCredentials();
    const session = await this.getSession();

    const response = await this.schedule(() =>
      fetch(`${baseUrl}${path}`, {
        headers: {
          'X-CAP-API-KEY': apiKey,
          CST: session.cst,
          'X-SECURITY-TOKEN': session.securityToken,
        },
        cache: 'no-store',
      }),
    );

    if (response.status === 401 && retryOnAuthFailure) {
      await this.getSession(true);
      return this.request<T>(path, false);
    }

    // Backing off and retrying beats failing a whole backtest on one 429.
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS * 2 ** attempt));
      return this.request<T>(path, retryOnAuthFailure, attempt + 1);
    }

    const body = (await response.json().catch(() => ({}))) as T & CapitalErrorBody;
    if (!response.ok || body.errorCode) {
      throw new CapitalApiError(
        `Capital.com request failed: ${path}`,
        response.status,
        body.errorCode,
      );
    }
    return body;
  }

  /** Live snapshot: bid/ask, market status and quoting precision. */
  getMarket(epic: string): Promise<CapitalMarketDetails> {
    return this.request<CapitalMarketDetails>(`/api/v1/markets/${encodeURIComponent(epic)}`);
  }

  /** Snapshots for several instruments in one request — the cheap price poll. */
  async getMarkets(epics: string[]): Promise<CapitalMarketDetails[]> {
    const params = new URLSearchParams({ epics: epics.join(',') });
    const body = await this.request<CapitalMarketsResponse>(`/api/v1/markets?${params}`);
    return body.marketDetails ?? [];
  }

  /** A single page of candles, optionally ending at `to` (UTC, inclusive). */
  private async getPricePage(
    epic: string,
    resolution: Timeframe,
    max: number,
    to?: Date,
  ): Promise<CapitalPrice[]> {
    const params = new URLSearchParams({ resolution, max: String(max) });
    if (to) params.set('to', toApiTime(to));
    const body = await this.request<CapitalPricesResponse>(
      `/api/v1/prices/${encodeURIComponent(epic)}?${params}`,
    );
    return body.prices ?? [];
  }

  /**
   * Fetches `count` candles ending now, paging backwards when `count` exceeds
   * the per-request ceiling. Result is ascending by time and free of duplicates.
   */
  async getCandles(epic: string, resolution: Timeframe, count: number): Promise<CapitalPrice[]> {
    const collected: CapitalPrice[] = [];
    let cursor: Date | undefined;

    while (collected.length < count) {
      const remaining = count - collected.length;
      const page = await this.getPricePage(
        epic,
        resolution,
        Math.min(remaining, MAX_CANDLES_PER_REQUEST),
        cursor,
      );
      if (page.length === 0) break;

      const earliest = parseUtc(page[0].snapshotTimeUTC);
      // The boundary candle is returned again on the next page; drop it there.
      collected.unshift(...(cursor ? page.slice(0, -1) : page));
      if (cursor && earliest.getTime() >= cursor.getTime()) break; // no progress
      cursor = earliest;
    }

    return collected;
  }

  /** Convenience helper: candles for every timeframe the strategy needs. */
  async getCandlesForRoles(
    epic: string,
    roles: Record<string, Timeframe>,
    depth: Record<string, number> = CANDLE_DEPTH,
  ): Promise<Record<string, CapitalPrice[]>> {
    const entries = await Promise.all(
      Object.entries(roles).map(async ([role, resolution]) => {
        const candles = await this.getCandles(epic, resolution, depth[role] ?? 300);
        return [role, candles] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
}

/** Formats a date as the `YYYY-MM-DDTHH:mm:ss` UTC string the API expects. */
export function toApiTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/** The API omits the timezone suffix on UTC timestamps; add it before parsing. */
export function parseUtc(timestamp: string): Date {
  return new Date(`${timestamp}Z`);
}

/** Module-level singleton so the session is shared across requests. */
export const capital = new CapitalClient();
