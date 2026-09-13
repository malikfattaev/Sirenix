/**
 * Threshold sweep: downloads history once per instrument, then replays the same
 * candles under different settings so changes can be judged on evidence.
 * Usage: npx tsx --env-file=.env.local scripts/research/sweep.ts <days> <field=a,b,c> ...
 */
import { DEFAULT_TUNING, INSTRUMENTS, type StrategyTuning } from '@/lib/config';
import { loadHistory } from '../lib/data';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';

const days = Number(process.argv[2] ?? 6);
const overrides = process.argv.slice(3).map((argument) => {
  const [field, values] = argument.split('=');
  return { field: field as keyof StrategyTuning, values: values.split(',').map(Number) };
});

/** Cartesian product of the requested field values. */
function buildGrid(): StrategyTuning[] {
  return overrides.reduce<StrategyTuning[]>(
    (combos, { field, values }) =>
      combos.flatMap((combo) => values.map((value) => ({ ...combo, [field]: value }))),
    [{ ...DEFAULT_TUNING }],
  );
}

const label = (tuning: StrategyTuning) =>
  overrides.map(({ field }) => `${field}=${tuning[field]}`).join(' ') || 'default';

function line(name: string, result: BacktestResult) {
  const { signals, wins, losses, timeouts, winRate, avgRiskReward, totalR, profitFactor } = result;
  return (
    `${name.padEnd(46)} n=${String(signals).padStart(3)} W/L ${String(wins).padStart(3)}/${String(losses).padEnd(3)} ` +
    `to=${String(timeouts).padStart(3)} win=${String(winRate).padStart(5)}% RR=1:${avgRiskReward.toFixed(2)} ` +
    `hold=${String(result.avgHoldMinutes).padStart(5)}m exp=${result.expectancy.toFixed(3).padStart(6)}R ` +
    `total=${totalR.toFixed(1).padStart(6)}R PF=${profitFactor?.toFixed(2) ?? '  — '}`
  );
}

async function main() {
  const grid = buildGrid();
  const data = new Map<string, BacktestData>();

  for (const instrument of INSTRUMENTS) {
    const loaded = await loadHistory(instrument, days);
    data.set(instrument.id, loaded);
    const trigger = loaded.candles.entry;
    console.log(
      `${instrument.label}: ${trigger.length} x 1m candles, ` +
        `${new Date(trigger[0].time).toISOString().slice(0, 10)} → ${new Date(trigger.at(-1)!.time).toISOString().slice(0, 10)}`,
    );
  }

  console.log(`\nReplaying ${grid.length} setting(s) over ${days} days\n`);
  const totals: { name: string; totalR: number; signals: number; wins: number; losses: number }[] = [];

  for (const tuning of grid) {
    let combinedR = 0;
    let combinedSignals = 0;
    let combinedWins = 0;
    let combinedLosses = 0;
    for (const instrument of INSTRUMENTS) {
      const result = replay(instrument, data.get(instrument.id)!, { days, tuning });
      console.log(line(`${instrument.id} ${label(tuning)}`, result));
      combinedR += result.totalR;
      combinedSignals += result.signals;
      combinedWins += result.wins;
      combinedLosses += result.losses;
    }
    totals.push({ name: label(tuning), totalR: combinedR, signals: combinedSignals, wins: combinedWins, losses: combinedLosses });
    console.log('');
  }

  console.log('=== combined, best first ===');
  for (const total of [...totals].sort((a, b) => b.totalR - a.totalR)) {
    const winRate = total.signals ? ((total.wins / total.signals) * 100).toFixed(1) : '0.0';
    console.log(
      `${total.name.padEnd(40)} n=${String(total.signals).padStart(3)} win=${winRate.padStart(5)}% total=${total.totalR.toFixed(1).padStart(6)}R`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
