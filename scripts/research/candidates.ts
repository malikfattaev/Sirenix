/**
 * Runs the live scalping engine, unchanged, over markets that are not on the
 * board, to see which of them it would actually trade well.
 *
 * A cheap spread only says a market is affordable; this says whether the
 * strategies find anything in it. Each market is scored on both halves of the
 * window, because a result that only holds in one is noise.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/candidates.ts <days>
 */
import type { InstrumentConfig } from '@/lib/config';
import { replay, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';

const days = Number(process.argv[2] ?? 14);

/** The cheapest markets from the spread screen, plus the two already traded. */
const CANDIDATES: InstrumentConfig[] = [
  { id: 'GOLD', epic: 'GOLD', label: 'GOLD' },
  { id: 'BRENT', epic: 'OIL_BRENT', label: 'BRENT OIL' },
  { id: 'US30', epic: 'US30', label: 'US 30' },
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40' },
  { id: 'US100', epic: 'US100', label: 'US TECH 100' },
  { id: 'UK100', epic: 'UK100', label: 'UK 100' },
  { id: 'US500', epic: 'US500', label: 'US 500' },
  { id: 'J225', epic: 'J225', label: 'JAPAN 225' },
  { id: 'WTI', epic: 'OIL_CRUDE', label: 'WTI CRUDE' },
  { id: 'USDJPY', epic: 'USDJPY', label: 'USD/JPY' },
  { id: 'AUDJPY', epic: 'AUDJPY', label: 'AUD/JPY' },
  { id: 'CADJPY', epic: 'CADJPY', label: 'CAD/JPY' },
];

const cell = (r: BacktestResult) =>
  `${String(r.signals).padStart(3)} ${r.winRate.toFixed(0).padStart(3)}% ` +
  `${((r.totalR > 0 ? '+' : '') + r.totalR.toFixed(1) + 'R').padStart(8)}`;

async function main() {
  console.log(`${days} days of one-minute history, live settings\n`);
  console.log(
    `${'market'.padEnd(13)} ${'/day'.padStart(5)} ${'n'.padStart(4)} ${'win'.padStart(5)} ` +
      `${'total'.padStart(8)}   first half         second half`,
  );

  const rows: { label: string; whole: BacktestResult; first: BacktestResult; second: BacktestResult }[] = [];

  for (const instrument of CANDIDATES) {
    try {
      const data = await loadHistory(instrument, days);
      const whole = replay(instrument, data, { days });
      if (whole.signals === 0) {
        console.log(`${instrument.label.padEnd(13)} no signals`);
        continue;
      }
      const first = replay(instrument, data, { days, sample: [0, 0.5] });
      const second = replay(instrument, data, { days, sample: [0.5, 1] });
      rows.push({ label: instrument.label, whole, first, second });

      console.log(
        `${instrument.label.padEnd(13)} ${(whole.signals / days).toFixed(1).padStart(5)} ` +
          `${String(whole.signals).padStart(4)} ${whole.winRate.toFixed(0).padStart(4)}% ` +
          `${((whole.totalR > 0 ? '+' : '') + whole.totalR.toFixed(1) + 'R').padStart(8)}   ` +
          `${cell(first)}  ${cell(second)}`,
      );
    } catch (error) {
      console.log(`${instrument.label.padEnd(13)} unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  const good = rows.filter((row) => row.first.totalR > 0 && row.second.totalR > 0);
  console.log(`\nPositive in BOTH halves: ${good.length === 0 ? 'none' : good.map((r) => r.label).join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
