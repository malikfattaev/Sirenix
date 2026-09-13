import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { INSTRUMENTS, intradayTuning } from '@/lib/config';
import { replayIntraday, intradayStats } from '@/lib/intraday/replay';
import type { Candle } from '@/lib/market/candles';

// Cached data only: no broker calls or live settings/database changes.
const directory = path.join(process.cwd(), 'data', 'intraday-cache');
for (const instrument of INSTRUMENTS) {
  const file = readdirSync(directory).filter((name) => name.startsWith(`${instrument.epic}-5000-`)).sort().at(-1);
  if (!file) throw new Error(`No cached 15m candles for ${instrument.id}`);
  const candles = JSON.parse(readFileSync(path.join(directory, file), 'utf8')) as Candle[];
  const baseline = intradayTuning(instrument.id);
  const cutoff = (candles[0].time + candles[candles.length - 1].closeTime) / 2;
  const rows = [];
  for (const threshold of [1.4, 1.8, 2.2]) {
    for (const targetAtr of [1.5, 2, 2.5]) {
      const tuning = { ...baseline, threshold, targetAtr };
      const trades = replayIntraday(instrument, candles, tuning);
      // Drop boundary-crossing trades so one outcome cannot span both periods.
      const first = intradayStats(trades.filter((t) => t.closedAt < cutoff));
      const second = intradayStats(trades.filter((t) => t.openedAt >= cutoff));
      const whole = intradayStats(trades);
      rows.push({ threshold, targetAtr, trades: whole.trades,
        perDay: +(whole.trades / ((candles.at(-1)!.closeTime - candles[299].closeTime) / 86_400_000)).toFixed(2),
        firstTrades: first.trades, firstR: +first.totalR.toFixed(2),
        secondTrades: second.trades, secondR: +second.totalR.toFixed(2),
        totalR: +whole.totalR.toFixed(2), averageR: +whole.averageR.toFixed(3), drawdownR: +whole.drawdownR.toFixed(2) });
    }
  }
  console.log(`\n${instrument.id}: ${file}; cutoff ${new Date(cutoff).toISOString()}`);
  console.table(rows);
  const selected = [...rows].sort((a, b) => b.firstR - a.firstR)[0];
  console.log('Best first-period total R; inspect second period separately:', selected);
}
console.log('\nResearch only. 15m spread approximations, fixed default cooldowns, session-gap entries excluded.');
console.log('History was previously explored; the second period is not a fresh unseen validation set. No settings applied.');
