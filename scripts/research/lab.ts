/**
 * Strategy lab: runs every setup in isolation, on two halves of the history.
 *
 * The first half is where an idea is allowed to look good; the second half is
 * where it has to prove it. A strategy that only works on one of them is noise.
 * Usage: npx tsx --env-file=.env.local scripts/research/lab.ts <days>
 */
import { DEFAULT_TUNING, INSTRUMENTS, type StrategyKey } from '@/lib/config';
import { loadHistory } from '../lib/data';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { STRATEGIES } from '@/lib/strategy';

const days = Number(process.argv[2] ?? 21);

const SAMPLES: { name: string; range: [number, number] }[] = [
  { name: 'first half', range: [0, 0.5] },
  { name: 'second half', range: [0.5, 1] },
];

const cell = (result: BacktestResult) =>
  `${String(result.signals).padStart(3)} ${String(result.winRate).padStart(5)}% ${result.expectancy.toFixed(3).padStart(7)}R ${result.totalR.toFixed(1).padStart(6)}R`;

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of INSTRUMENTS) {
    const loaded = await loadHistory(instrument, days);
    data.set(instrument.id, loaded);
    const bars = loaded.candles.entry;
    console.log(
      `${instrument.label}: ${bars.length} x 1m, ` +
        `${new Date(bars[0].time).toISOString().slice(0, 10)} to ${new Date(bars.at(-1)!.time).toISOString().slice(0, 10)}`,
    );
  }

  for (const instrument of INSTRUMENTS) {
    console.log(`\n================ ${instrument.label} ================`);
    console.log(`${'strategy'.padEnd(18)} ${'first half  n  win%    exp   total'.padEnd(32)} second half`);

    const keys: (StrategyKey | null)[] = [null, ...STRATEGIES.map((s) => s.key)];
    for (const key of keys) {
      const tuning = { ...DEFAULT_TUNING, enabledStrategies: key === null ? null : [key] };
      const cells = SAMPLES.map(({ range }) =>
        cell(replay(instrument, data.get(instrument.id)!, { days, tuning, sample: range })),
      );
      console.log(`${(key ?? 'ALL COMBINED').padEnd(18)} ${cells[0]}   ${cells[1]}`);
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
