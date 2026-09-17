/**
 * How long a position has to be held before the entries are worth anything.
 *
 * This began as a sweep of the stop and the target, on the theory that the
 * trades closed by the clock were profitable and only the geometry was wrong.
 * That theory was false — a trade reaches the clock precisely by not having hit
 * its stop, so the bucket is positive by construction — and `direction.ts`
 * settled it by removing both barriers: the engine picks the right side 45% of
 * the time at twenty minutes and 44% at two hours. No placement of a stop
 * rescues a coin flip.
 *
 * The same test carried on past the account's two-hour ceiling and found
 * something else. At six hours the signals are worth +0.22R, at twelve +0.52R
 * with a median of +0.67 and a 54% hit rate. The spread is a fixed cost and the
 * move grows roughly with the square root of the time held, so the two cross
 * somewhere in between — which is what the hourly study measured independently
 * at twelve to twenty-four hours.
 *
 * So the sweep is now about the hold, and the stop and target are swept only
 * widely enough to show they are not what decides it. The long holds are well
 * outside what the account currently allows, and are here to put a number on
 * what that limit costs rather than to propose breaking it.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/geometry.ts [days]
 */
import { DEFAULT_TUNING } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';
import { ACTIVE_MARKETS } from '../lib/universe';

const days = Number(process.argv[2] ?? 41);

/**
 * Stop and target are held at the live values.
 *
 * They were swept once, three values each against three holds, and the machine
 * ran out of memory before it finished — 528 replays of six weeks of minutes is
 * more than this is worth. It is also the wrong question: `direction.ts` showed
 * the entries are a coin flip inside two hours, so no placement of a barrier
 * can rescue them, and the one variable that changes the answer is how long the
 * position is held. One geometry, four holds.
 */
const STOP_BUFFER = [0.6];
const TARGET_CEILING = [1.8];

/**
 * Minutes before the clock closes the position at market.
 *
 * Twenty is what the engine does now and 120 is the account's stated ceiling.
 * The rest are past it, because that is where the entries stop being a coin
 * flip, and a limit is easier to argue about with its cost written down.
 */
const HOLD = [20, 120, 360, 720];


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
