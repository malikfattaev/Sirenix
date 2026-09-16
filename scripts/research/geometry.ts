/**
 * Can any placement of the stop and the target rescue a coin flip?
 *
 * `anatomy.ts` priced the three ways a trade can end, over 332 of them: 19%
 * reached the target and paid 1.83R, 54% were stopped and paid -1R, and the
 * remaining 27% ran out of time and were closed at market for +0.357R each.
 * That last bucket looked for a moment like evidence the entries point the
 * right way and only the geometry is wrong.
 *
 * It is not. A trade reaches the clock precisely by not having hit its stop,
 * and "did not fall" is most of the way to "rose", so the bucket is positive by
 * construction. `direction.ts` removed both barriers and followed every signal
 * for a fixed number of minutes instead: 47% right at twenty minutes, 49% at
 * sixty, 45% at two hours. There is no edge under the geometry.
 *
 * This sweep is therefore not a search but the end of the argument. Three
 * things decide what happens between the entry and the exit — how far the stop
 * sits beyond the invalidation level, how far the target may be, and how long
 * the position is given — and they are swept together because they interact: a
 * wider stop is a worse reward-to-risk and has to earn it back with a higher
 * hit rate, and a longer hold only helps if the stop survives the extra time.
 *
 * If a row here comes out positive on both halves it is a configuration fitted
 * to six weeks, not a finding, because nothing underneath it predicts anything.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/geometry.ts [days]
 */
import { DEFAULT_TUNING } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';
import { ACTIVE_MARKETS } from '../lib/universe';

const days = Number(process.argv[2] ?? 41);

/** Stop distance beyond the invalidation level, in entry-frame ATRs. */
const STOP_BUFFER = [0.6, 1.2, 2.0];

/** Ceiling on how far the first target may sit, in setup ATRs. */
const TARGET_CEILING = [1.0, 1.8, 3.0];

/** Minutes before the clock closes the position at market. */
const HOLD = [20, 60, 120];


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
  for (const instrument of ACTIVE_MARKETS) {
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

        for (const instrument of ACTIVE_MARKETS) {
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
