/** Disk-cached candles at any resolution, so a study does not re-download the universe. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { capital } from '@/lib/capital/client';
import type { Timeframe } from '@/lib/config';
import { toCandles, type Candle } from '@/lib/market/candles';

const CACHE_DIR = path.join(process.cwd(), 'data', 'candle-cache');

/**
 * Downloads once per market per resolution per day, then reads from disk.
 *
 * A study that sweeps parameters replays the same window dozens of times, and a
 * deep request at five-minute resolution is forty paged calls against a rate
 * limit — several minutes for a board of thirteen markets. The stamp is the
 * day: on a window of tens of thousands of bars the handful that close while a
 * study is being edited cannot change an average, and an hourly stamp only
 * meant that a download straddling the hour left half the board stale and paid
 * for the whole thing again on the next run.
 */
export async function cachedCandles(
  epic: string,
  resolution: Timeframe,
  bars: number,
): Promise<Candle[]> {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(CACHE_DIR, `${epic}-${resolution}-${bars}-${stamp}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Candle[];

  const candles = toCandles(await capital.getCandles(epic, resolution, bars), resolution);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(candles));
  return candles;
}
