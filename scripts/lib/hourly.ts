/** Disk-cached hourly history, so a parameter grid does not re-download the universe. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { capital } from '@/lib/capital/client';
import { toCandles, type Candle } from '@/lib/market/candles';

const CACHE_DIR = path.join(process.cwd(), 'data', 'hourly-cache');

export async function hourlyCandles(epic: string, bars: number): Promise<Candle[]> {
  const stamp = new Date().toISOString().slice(0, 13).replace('T', '-');
  const file = path.join(CACHE_DIR, `${epic}-${bars}-${stamp}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Candle[];

  const candles = toCandles(await capital.getCandles(epic, 'HOUR', bars), 'HOUR');
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(candles));
  return candles;
}
