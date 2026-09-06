/**
 * Tests specific sets of strategies against both halves of the history.
 * Usage: npx tsx --env-file=.env.local scripts/combo.ts <days>
 */
import { DEFAULT_TUNING, INSTRUMENTS, type StrategyKey } from '@/lib/config';
import { loadHistory } from './data';
import { replay, type BacktestData } from '@/lib/backtest/engine';

const days = Number(process.argv[2] ?? 21);

const COMBOS: { name: string; keys: StrategyKey[] | null }[] = [
  { name: 'everything', keys: null },
  {
    name: 'drop the 4/4 losers',
    keys: ['breakout-retest', 'momentum', 'pullback-fade', 'mean-reversion', 'opening-range'],
  },
  { name: 'breakout-retest only', keys: ['breakout-retest'] },
  { name: 'breakout + momentum', keys: ['breakout-retest', 'momentum'] },
  { name: 'reversion only', keys: ['pullback-fade', 'mean-reversion', 'sr-bounce', 'failed-breakout'] },
  { name: 'continuation only', keys: ['trend-pullback', 'breakout-retest', 'momentum', 'vwap-pullback', 'opening-range'] },
];

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of INSTRUMENTS) data.set(instrument.id, await loadHistory(instrument, days));

  console.log(`${'combination'.padEnd(24)} ${'instrument'.padEnd(6)}  first half            second half`);
  for (const combo of COMBOS) {
    for (const instrument of INSTRUMENTS) {
      const tuning = { ...DEFAULT_TUNING, enabledStrategies: combo.keys };
      const halves = ([[0, 0.5], [0.5, 1]] as [number, number][]).map((sample) =>
        replay(instrument, data.get(instrument.id)!, { days, tuning, sample }),
      );
      console.log(
        `${combo.name.padEnd(24)} ${instrument.id.padEnd(6)}  ` +
          halves
            .map((r) => `n=${String(r.signals).padStart(3)} win=${String(r.winRate).padStart(5)}% ${r.totalR.toFixed(1).padStart(6)}R`)
            .join('   '),
      );
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
