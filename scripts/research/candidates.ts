/**
 * Runs the live scalping engine, unchanged, over every market worth a look, to
 * see which of them it would actually trade well.
 *
 * A cheap spread only says a market is affordable; this says whether the
 * strategies find anything in it. Each market is scored on both halves of the
 * window, because a result that only holds in one is noise, and both halves
 * have to have traded enough times to be worth reading — a market that takes
 * four trades can post any number at all.
 *
 * Frequency is reported beside the result and is not a tiebreaker but a
 * requirement of its own: a board that produces one signal a week is not a
 * board anyone can trade, however good that signal is.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/candidates.ts [days]
 */
import type { InstrumentConfig } from '@/lib/config';
import { replay, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';

const days = Number(process.argv[2] ?? 41);

/** Both halves must trade at least this often before the result means anything. */
const MIN_SIGNALS_PER_HALF = 8;

/**
 * Every index Capital quotes, plus the commodities and crosses that have been
 * on the board or near it, so the comparison is against the whole field rather
 * than against the markets that happen to be running now.
 */
const CANDIDATES: InstrumentConfig[] = [
  { id: 'US30', epic: 'US30', label: 'US 30' },
  { id: 'US500', epic: 'US500', label: 'US 500' },
  { id: 'US100', epic: 'US100', label: 'US TECH 100' },
  { id: 'RTY', epic: 'RTY', label: 'US 2000' },
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40' },
  { id: 'UK100', epic: 'UK100', label: 'UK 100' },
  { id: 'FR40', epic: 'FR40', label: 'FRANCE 40' },
  { id: 'NL25', epic: 'NL25', label: 'NETHERLANDS 25' },
  { id: 'SP35', epic: 'SP35', label: 'SPAIN 35' },
  { id: 'SW20', epic: 'SW20', label: 'SWITZERLAND 20' },
  { id: 'J225', epic: 'J225', label: 'JAPAN 225' },
  { id: 'AU200', epic: 'AU200', label: 'AUSTRALIA 200' },
  { id: 'HK50', epic: 'HK50', label: 'HONG KONG 50' },
  { id: 'HSTECH', epic: 'HSTECH', label: 'HS TECH' },
  { id: 'HSCE', epic: 'HSCE', label: 'CHINA H-SHARES' },
  { id: 'CN50', epic: 'CN50', label: 'CHINA 50' },
  { id: 'GOLD', epic: 'GOLD', label: 'GOLD' },
  { id: 'SILVER', epic: 'SILVER', label: 'SILVER' },
  { id: 'COPPER', epic: 'COPPER', label: 'COPPER' },
  { id: 'BRENT', epic: 'OIL_BRENT', label: 'BRENT OIL' },
  { id: 'WTI', epic: 'OIL_CRUDE', label: 'WTI CRUDE' },
  { id: 'NATURALGAS', epic: 'NATURALGAS', label: 'NATURAL GAS' },
  { id: 'USDJPY', epic: 'USDJPY', label: 'USD/JPY' },
  { id: 'AUDJPY', epic: 'AUDJPY', label: 'AUD/JPY' },
  { id: 'GBPJPY', epic: 'GBPJPY', label: 'GBP/JPY' },
  { id: 'EURUSD', epic: 'EURUSD', label: 'EUR/USD' },
];

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}R`;

const cell = (result: BacktestResult) =>
  `${String(result.signals).padStart(3)} ${result.winRate.toFixed(0).padStart(3)}% ${signed(result.totalR).padStart(7)}`;

interface Row {
  label: string;
  whole: BacktestResult;
  first: BacktestResult;
  second: BacktestResult;
}

async function main() {
  console.log(`${days} days of one-minute history, live settings\n`);
  console.log(
    `  ${'market'.padEnd(16)} ${'/day'.padStart(5)} ${'n'.padStart(4)} ${'win'.padStart(5)} ` +
      `${'exp'.padStart(8)} ${'total'.padStart(8)}   first half        second half`,
  );

  const rows: Row[] = [];

  for (const instrument of CANDIDATES) {
    try {
      const data = await loadHistory(instrument, days);
      const whole = replay(instrument, data, { days });
      if (whole.signals === 0) {
        console.log(`  ${instrument.label.padEnd(16)} no signals`);
        continue;
      }

      const first = replay(instrument, data, { days, sample: [0, 0.5] });
      const second = replay(instrument, data, { days, sample: [0.5, 1] });
      rows.push({ label: instrument.label, whole, first, second });

      const survives =
        first.totalR > 0 &&
        second.totalR > 0 &&
        Math.min(first.signals, second.signals) >= MIN_SIGNALS_PER_HALF;

      console.log(
        `  ${instrument.label.padEnd(16)} ${(whole.signals / days).toFixed(1).padStart(5)} ` +
          `${String(whole.signals).padStart(4)} ${whole.winRate.toFixed(0).padStart(4)}% ` +
          `${whole.expectancy.toFixed(3).padStart(7)}R ${signed(whole.totalR).padStart(8)}   ` +
          `${cell(first)}  ${cell(second)}` +
          (survives ? '  <-- SURVIVES' : ''),
      );
    } catch (error) {
      console.log(`  ${instrument.label.padEnd(16)} unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  const good = rows
    .filter(
      (row) =>
        row.first.totalR > 0 &&
        row.second.totalR > 0 &&
        Math.min(row.first.signals, row.second.signals) >= MIN_SIGNALS_PER_HALF,
    )
    .sort((a, b) => b.whole.totalR - a.whole.totalR);

  console.log(`\n  Positive on both halves, with ${MIN_SIGNALS_PER_HALF}+ signals in each:`);
  if (good.length === 0) {
    console.log('    none');
    return;
  }
  for (const row of good) {
    console.log(
      `    ${row.label.padEnd(16)} ${signed(row.whole.totalR).padStart(7)} ` +
        `over ${String(row.whole.signals).padStart(3)} signals, ${(row.whole.signals / days).toFixed(1)} a day`,
    );
  }

  const board = good.slice(0, 10);
  console.log(
    `\n  A board of the best ${board.length}: ${signed(board.reduce((sum, row) => sum + row.whole.totalR, 0))}` +
      ` over ${board.reduce((sum, row) => sum + row.whole.signals, 0)} signals` +
      `, ${(board.reduce((sum, row) => sum + row.whole.signals, 0) / days).toFixed(1)} a day.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
