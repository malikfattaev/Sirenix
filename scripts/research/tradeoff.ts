/**
 * The frequency-versus-quality table.
 *
 * More signals always means a lower bar, and a lower bar means a lower win
 * rate. This measures exactly how much, so the threshold is a choice made on
 * numbers rather than on feel. Each row is checked on both halves of the
 * window: a setting that only works on one of them is noise.
 *
 * Usage: npx tsx --env-file=.env.local scripts/research/tradeoff.ts <days>
 */
import { DEFAULT_TUNING, INSTRUMENTS, type StrategyKey } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { STRATEGIES } from '@/lib/strategy';
import { loadHistory } from '../lib/data';

const days = Number(process.argv[2] ?? 21);

const ALL_KEYS = STRATEGIES.map((strategy) => strategy.key);
/** News momentum never fires in a replay: the feeds do not reach back. */
const REPLAYABLE = ALL_KEYS.filter((key) => key !== 'news-drive');

const SETS: { name: string; keys: StrategyKey[] }[] = [
  { name: 'current 5', keys: DEFAULT_TUNING.enabledStrategies ?? REPLAYABLE },
  { name: 'all 8', keys: REPLAYABLE },
];

const SCORES = [40, 46, 52, 58, 62, 68];

const merge = (results: BacktestResult[]) => {
  const signals = results.reduce((sum, r) => sum + r.signals, 0);
  const wins = results.reduce((sum, r) => sum + r.wins, 0);
  const totalR = results.reduce((sum, r) => sum + r.totalR, 0);
  return {
    signals,
    winRate: signals === 0 ? 0 : (wins / signals) * 100,
    totalR,
    perDay: signals / days,
  };
};

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of INSTRUMENTS) {
    data.set(instrument.id, await loadHistory(instrument, days));
  }

  console.log(`${days} days, gold and Brent combined\n`);
  console.log(
    `${'strategies'.padEnd(12)} ${'min'.padStart(4)}  ${'n'.padStart(4)} ${'/day'.padStart(5)} ` +
      `${'win'.padStart(6)} ${'total'.padStart(8)}   first half        second half`,
  );

  for (const set of SETS) {
    for (const minScore of SCORES) {
      const tuning = { ...DEFAULT_TUNING, minScore, enabledStrategies: set.keys };
      const run = (sample: [number, number]) =>
        merge(INSTRUMENTS.map((instrument) => replay(instrument, data.get(instrument.id)!, { days, tuning, sample })));

      const whole = run([0, 1]);
      const first = run([0, 0.5]);
      const second = run([0.5, 1]);
      const half = (h: { signals: number; winRate: number; totalR: number }) =>
        `${String(h.signals).padStart(3)} ${h.winRate.toFixed(0).padStart(3)}% ${(h.totalR > 0 ? '+' : '') + h.totalR.toFixed(1)}R`.padEnd(18);

      console.log(
        `${set.name.padEnd(12)} ${String(minScore).padStart(4)}  ${String(whole.signals).padStart(4)} ` +
          `${whole.perDay.toFixed(1).padStart(5)} ${whole.winRate.toFixed(1).padStart(5)}% ` +
          `${((whole.totalR > 0 ? '+' : '') + whole.totalR.toFixed(1) + 'R').padStart(8)}   ${half(first)}${half(second)}`,
      );
    }
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
