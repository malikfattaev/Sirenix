/**
 * Where the stop and the target belong, given that the entries are not the problem.
 *
 * `anatomy.ts` priced the three ways a trade can end, over 332 of them on six
 * markets and six weeks. Nineteen percent reached the target and paid 1.83R.
 * Fifty-four percent were stopped and paid -1R. The remaining twenty-seven
 * percent ran out of time and were closed at market for **+0.357R each** —
 * which is the whole reason this sweep exists. A position closed by the clock
 * has no thesis behind its exit price; if that bucket is reliably positive, the
 * entries are pointing the right way and the money is being lost between the
 * entry and the target, not at it.
 *
 * Three things decide what happens in between, and this sweeps all three:
 *
 *  - how far the stop sits beyond the level that invalidates the setup,
 *  - how far the first target is allowed to be,
 *  - and how long the position is given before the clock takes it.
 *
 * The three interact, which is why they are swept together rather than one at a
 * time: a wider stop with the same target is a worse reward-to-risk and has to
 * earn it back with a higher hit rate, and a longer hold only helps if the stop
 * is far enough away to survive the extra time.
 *
 * Both halves of the sample have to pay, and both have to have traded enough to
 * be read. Everything here is measured on the same six weeks, so a row that
 * survives is a candidate to test on new data, not a finding.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/geometry.ts [days]
 */
import { DEFAULT_TUNING, type InstrumentConfig } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';

const days = Number(process.argv[2] ?? 41);

/** Stop distance beyond the invalidation level, in entry-frame ATRs. */
const STOP_BUFFER = [0.6, 1.2, 2.0];

/** Ceiling on how far the first target may sit, in setup ATRs. */
const TARGET_CEILING = [1.0, 1.8, 3.0];

/** Minutes before the clock closes the position at market. */
const HOLD = [20, 60, 120];

const MARKETS: InstrumentConfig[] = [
  { id: 'US30', epic: 'US30', label: 'US 30' },
  { id: 'US100', epic: 'US100', label: 'US TECH 100' },
  { id: 'NL25', epic: 'NL25', label: 'NETHERLANDS 25' },
  { id: 'FR40', epic: 'FR40', label: 'FRANCE 40' },
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40' },
  { id: 'US500', epic: 'US500', label: 'US 500' },
];

/** Both halves must trade this often before a row is worth reading. */
const MIN_PER_HALF = 10;

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}R`;

interface Cell {
  signals: number;
  totalR: number;
  winRate: number;
}

const add = (a: Cell, b: BacktestResult): Cell => ({
  signals: a.signals + b.signals,
  totalR: a.totalR + b.totalR,
  winRate: 0,
});

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of MARKETS) {
    try {
      data.set(instrument.id, await loadHistory(instrument, days));
    } catch (error) {
      console.error(`${instrument.label}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(
    `\n${days} days, ${data.size} markets pooled. Stop buffer x target ceiling x hold.\n`,
  );
  console.log(
    `  ${'stop'.padEnd(6)} ${'target'.padEnd(7)} ${'hold'.padEnd(6)} ` +
      `${'n'.padStart(5)} ${'/day'.padStart(5)} ${'win'.padStart(5)} ${'exp'.padStart(8)} ${'total'.padStart(8)}  ` +
      `${'first'.padStart(8)} ${'second'.padStart(8)}`,
  );

  const rows: { line: string; totalR: number; survives: boolean }[] = [];

  for (const stopBufferAtr of STOP_BUFFER) {
    for (const maxTargetAtr of TARGET_CEILING) {
      for (const maxHoldMinutes of HOLD) {
        const tuning = { ...DEFAULT_TUNING, stopBufferAtr, maxTargetAtr, maxHoldMinutes };

        let whole: Cell = { signals: 0, totalR: 0, winRate: 0 };
        let first: Cell = { signals: 0, totalR: 0, winRate: 0 };
        let second: Cell = { signals: 0, totalR: 0, winRate: 0 };
        let wins = 0;

        for (const instrument of MARKETS) {
          const loaded = data.get(instrument.id);
          if (!loaded) continue;
          const all = replay(instrument, loaded, { days, tuning });
          whole = add(whole, all);
          wins += all.wins;
          first = add(first, replay(instrument, loaded, { days, tuning, sample: [0, 0.5] }));
          second = add(second, replay(instrument, loaded, { days, tuning, sample: [0.5, 1] }));
        }

        if (whole.signals === 0) continue;
        const survives =
          first.totalR > 0 && second.totalR > 0 && Math.min(first.signals, second.signals) >= MIN_PER_HALF;

        rows.push({
          totalR: whole.totalR,
          survives,
          line:
            `  ${String(stopBufferAtr).padEnd(6)} ${String(maxTargetAtr).padEnd(7)} ${`${maxHoldMinutes}m`.padEnd(6)} ` +
            `${String(whole.signals).padStart(5)} ${(whole.signals / days).toFixed(1).padStart(5)} ` +
            `${((wins / whole.signals) * 100).toFixed(0).padStart(4)}% ` +
            `${(whole.totalR / whole.signals).toFixed(3).padStart(7)}R ${signed(whole.totalR).padStart(8)}  ` +
            `${signed(first.totalR).padStart(8)} ${signed(second.totalR).padStart(8)}` +
            (survives ? '  <-- SURVIVES' : ''),
        });
      }
    }
  }

  for (const row of rows) console.log(row.line);

  const best = [...rows].sort((a, b) => b.totalR - a.totalR)[0];
  console.log(`\n  best by total:\n${best.line}`);
  console.log(`  rows positive on both halves: ${rows.filter((row) => row.survives).length} of ${rows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
