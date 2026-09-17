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
 * Three configurations, not a grid, and each one answers a question.
 *
 * The first is the live engine. The second and third come from what the hold
 * sweep found: at 360 minutes and at 720 the engine returns exactly the same
 * -64.4R, which can only mean no position survives to either. The stop reaches
 * it first, every time, and that is why lengthening the clock changed nothing.
 *
 * `direction.ts` measured its +0.52R at twelve hours with no stop at all. So
 * the question is whether a stop far enough away to be reached rarely lets that
 * through: the entry and the planned risk stay as they are, the barrier moves
 * out, and the position is given the time the measurement said it needs.
 */
const CONFIGURATIONS = [
  { note: 'live', stopBufferAtr: 0.6, maxStopAtr: 2.6, maxHoldMinutes: 20 },
  // A wide stop on its own issues one signal in six weeks: the target must
  // clear one and a half times the risk and may not sit beyond 1.8 ATR, so
  // widening the stop puts every setup out of reach of its own target. The
  // target has to travel with it or the test measures the reward rule instead.
  {
    note: 'wide, 2h',
    stopBufferAtr: 3.0,
    maxStopAtr: 8,
    maxTargetAtr: 6,
    minRiskReward: 0.8,
    minRewardToSpread: 3,
    maxHoldMinutes: 120,
  },
  {
    note: 'wide, 12h',
    stopBufferAtr: 3.0,
    maxStopAtr: 8,
    maxTargetAtr: 6,
    minRiskReward: 0.8,
    minRewardToSpread: 3,
    maxHoldMinutes: 720,
  },
  {
    note: 'very wide, 12h',
    stopBufferAtr: 6.0,
    maxStopAtr: 16,
    maxTargetAtr: 12,
    minRiskReward: 0.8,
    minRewardToSpread: 3,
    maxHoldMinutes: 720,
  },
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
  for (const instrument of ACTIVE_MARKETS) {
    try {
      data.set(instrument.id, await loadHistory(instrument, days));
    } catch (error) {
      console.error(`${instrument.label}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n${days} days, ${data.size} markets pooled.\n`);
  console.log(
    `  ${'configuration'.padEnd(16)} ${'n'.padStart(5)} ${'/day'.padStart(5)} ${'win'.padStart(5)} ` +
      `${'timeouts'.padStart(9)} ${'exp'.padStart(8)} ${'total'.padStart(8)}  ` +
      `${'first'.padStart(8)} ${'second'.padStart(8)}`,
  );

  for (const configuration of CONFIGURATIONS) {
    const { note, ...overrides } = configuration;
    const tuning = { ...DEFAULT_TUNING, ...overrides };

    let whole: Cell = { signals: 0, totalR: 0, winRate: 0 };
    let first: Cell = { signals: 0, totalR: 0, winRate: 0 };
    let second: Cell = { signals: 0, totalR: 0, winRate: 0 };
    let wins = 0;
    let timeouts = 0;

    for (const instrument of ACTIVE_MARKETS) {
      const loaded = data.get(instrument.id);
      if (!loaded) continue;
      const all = replay(instrument, loaded, { days, tuning });
      whole = add(whole, all);
      wins += all.wins;
      timeouts += all.timeouts;
      first = add(first, replay(instrument, loaded, { days, tuning, sample: [0, 0.5] }));
      second = add(second, replay(instrument, loaded, { days, tuning, sample: [0.5, 1] }));
    }

    if (whole.signals === 0) {
      console.log(`  ${note.padEnd(16)} no signals`);
      continue;
    }

    // How many positions the clock had to close rather than a barrier. When
    // this is near zero the hold is not the binding constraint, whatever it is
    // set to, and lengthening it cannot change the answer.
    const survives =
      first.totalR > 0 && second.totalR > 0 && Math.min(first.signals, second.signals) >= MIN_PER_HALF;

    console.log(
      `  ${note.padEnd(16)} ${String(whole.signals).padStart(5)} ` +
        `${(whole.signals / days).toFixed(1).padStart(5)} ` +
        `${((wins / whole.signals) * 100).toFixed(0).padStart(4)}% ` +
        `${`${((timeouts / whole.signals) * 100).toFixed(0)}%`.padStart(9)} ` +
        `${(whole.totalR / whole.signals).toFixed(3).padStart(7)}R ${signed(whole.totalR).padStart(8)}  ` +
        `${signed(first.totalR).padStart(8)} ${signed(second.totalR).padStart(8)}` +
        (survives ? '  <-- SURVIVES' : ''),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
