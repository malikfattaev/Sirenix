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

export async function loadHistory(
  instrument: InstrumentConfig,
  days: number,
): Promise<BacktestData> {
  const stamp = new Date().toISOString().slice(0, 13).replace('T', '-');
  const file = path.join(CACHE_DIR, `${instrument.id}-${days}d-${stamp}.json`);

  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')) as BacktestData;
  }

  const data = await loadBacktestData(instrument, days);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}
