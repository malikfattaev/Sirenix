/**
 * Strategy lab: runs every setup in isolation, pooled across the board, on two
 * halves of the history.
 *
 * The first half is where an idea is allowed to look good; the second half is
 * where it has to prove it. A strategy that only works on one of them is noise.
 *
 * Pooled rather than per-instrument, because the question this is asked for is
 * structural: the engine as a whole loses on every market it has been screened
 * on, and either one of the setups inside it is carrying the others or none of
 * them works. Per-market tables cannot answer that — thirty signals split five
 * ways is five results of six trades each, and six trades say nothing.
 *
 * Every setup is run, including the four that are switched off in the default
 * tuning, so that the decision to keep them off is re-examined rather than
 * assumed each time this is run on fresh data.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/lab.ts [days]
 */
import { DEFAULT_TUNING, type StrategyKey } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { STRATEGIES } from '@/lib/strategy';
import { loadHistory } from '../lib/data';
import { ACTIVE_MARKETS } from '../lib/universe';

const days = Number(process.argv[2] ?? 41);

/** Below this many trades in a half, a result is arithmetic rather than evidence. */
const MIN_PER_HALF = 10;

const SAMPLES: [number, number][] = [[0, 0.5], [0.5, 1]];

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}R`;

interface Total {
  signals: number;
  wins: number;
  totalR: number;
}

const empty = (): Total => ({ signals: 0, wins: 0, totalR: 0 });

const add = (into: Total, result: BacktestResult): Total => ({
  signals: into.signals + result.signals,
  wins: into.wins + result.wins,
  totalR: into.totalR + result.totalR,
});

const cell = (total: Total) =>
  `${String(total.signals).padStart(4)} ` +
  `${(total.signals ? (total.wins / total.signals) * 100 : 0).toFixed(0).padStart(3)}% ` +
  `${signed(total.totalR).padStart(8)}`;

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of ACTIVE_MARKETS) {
    try {
      data.set(instrument.id, await loadHistory(instrument, days));
    } catch (error) {
      console.error(`${instrument.label}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n${days} days, ${data.size} markets pooled, each setup alone.\n`);
  console.log(
    `  ${'setup'.padEnd(18)} ${'n'.padStart(5)} ${'/day'.padStart(5)} ${'win'.padStart(5)} ` +
      `${'exp'.padStart(8)} ${'total'.padStart(8)}   ${'first half'.padEnd(18)} second half`,
  );

  const keys: (StrategyKey | null)[] = [null, ...STRATEGIES.map((strategy) => strategy.key)];

  for (const key of keys) {
    const tuning = { ...DEFAULT_TUNING, enabledStrategies: key === null ? null : [key] };

    let whole = empty();
    const halves = [empty(), empty()];

    for (const instrument of ACTIVE_MARKETS) {
      const loaded = data.get(instrument.id);
      if (!loaded) continue;
      whole = add(whole, replay(instrument, loaded, { days, tuning }));
      for (const [index, sample] of SAMPLES.entries()) {
        halves[index] = add(halves[index], replay(instrument, loaded, { days, tuning, sample }));
      }
    }

    if (whole.signals === 0) {
      console.log(`  ${(key ?? 'ALL COMBINED').padEnd(18)} no signals`);
      continue;
    }

    const survives =
      halves.every((half) => half.totalR > 0) &&
      Math.min(...halves.map((half) => half.signals)) >= MIN_PER_HALF;

    console.log(
      `  ${(key ?? 'ALL COMBINED').padEnd(18)} ${String(whole.signals).padStart(5)} ` +
        `${(whole.signals / days).toFixed(1).padStart(5)} ` +
        `${((whole.wins / whole.signals) * 100).toFixed(0).padStart(4)}% ` +
        `${(whole.totalR / whole.signals).toFixed(3).padStart(7)}R ${signed(whole.totalR).padStart(8)}   ` +
        `${cell(halves[0])}  ${cell(halves[1])}` +
        (survives ? '  <-- SURVIVES' : ''),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
