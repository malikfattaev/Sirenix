/**
 * Disk-cached history for the research scripts.
 *
 * Downloading tens of thousands of one-minute candles takes minutes and burns
 * rate limit; the same window is reused across dozens of replays while an idea
 * is being tested, so it is fetched once per day and kept on disk.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadBacktestData, type BacktestData } from '@/lib/backtest/engine';
import type { InstrumentConfig } from '@/lib/config';

const CACHE_DIR =
  process.env.RESEARCH_CACHE_DIR ?? path.join(process.cwd(), 'data', 'research-cache');

/** How many times a dropped download is retried before the market is given up on. */
const ATTEMPTS = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Six weeks of history for one market, from disk when it is there.
 *
 * Deep windows are dozens of paged requests each, and across a screen of
 * twenty-odd markets one of them reliably drops — the broker times a page out
 * and the whole market is lost from the comparison, which is how a board gets
 * chosen from an incomplete field without anyone noticing. So a failed attempt
 * is retried, with a pause that lengthens each time in case the failure was the
 * rate limiter rather than the network.
 */
export async function loadHistory(
  instrument: InstrumentConfig,
  days: number,
): Promise<BacktestData> {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(CACHE_DIR, `${instrument.id}-${days}d-${stamp}.json`);

  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')) as BacktestData;
  }

  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const data = await loadBacktestData(instrument, days);
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(data));
      return data;
    } catch (error) {
      last = error;
      if (attempt < ATTEMPTS) await wait(attempt * 5000);
    }
  }
  throw last;
}
