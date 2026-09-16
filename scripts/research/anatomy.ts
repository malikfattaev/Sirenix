/**
 * Where the money actually goes: wins, stops and the trades that ran out of time.
 *
 * The candidate screen reports a win rate between 34% and 43% on every market
 * with a planned reward-to-risk of one and a half, and that combination should
 * sit around break-even rather than at minus a tenth of R a trade. Something
 * between the plan and the outcome is not paying what it promised, and there
 * are only three places it can be: the wins are smaller than planned, the
 * losses are larger, or the trades that neither win nor lose are carrying the
 * whole deficit.
 *
 * So this splits the result three ways and prices each one. A timeout is a
 * position closed at market because the clock ran out — it has no thesis behind
 * its exit price, and it is the only one of the three that the system chooses to
 * take rather than has forced on it.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/anatomy.ts [days]
 */
import { DEFAULT_TUNING, type InstrumentConfig } from '@/lib/config';
import { replay, type BacktestTrade } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';
import { mean } from '../lib/stats';

const days = Number(process.argv[2] ?? 41);

/** The markets the screen found worth reading — enough signals to say anything. */
const MARKETS: InstrumentConfig[] = [
  { id: 'US30', epic: 'US30', label: 'US 30' },
  { id: 'US100', epic: 'US100', label: 'US TECH 100' },
  { id: 'NL25', epic: 'NL25', label: 'NETHERLANDS 25' },
  { id: 'FR40', epic: 'FR40', label: 'FRANCE 40' },
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40' },
  { id: 'US500', epic: 'US500', label: 'US 500' },
];

function part(trades: BacktestTrade[], outcome: BacktestTrade['outcome']) {
  const here = trades.filter((trade) => trade.outcome === outcome);
  return {
    n: here.length,
    share: trades.length ? here.length / trades.length : 0,
    r: mean(here.map((trade) => trade.r)),
    total: here.reduce((sum, trade) => sum + trade.r, 0),
    hold: mean(here.map((trade) => trade.holdMinutes)),
  };
}

async function main() {
  console.log(`${days} days, live settings. Each outcome priced separately.\n`);
  console.log(
    `  ${'market'.padEnd(16)} ${'RR'.padStart(5)} ` +
      `${'win n'.padStart(6)} ${'avg R'.padStart(7)} ${'total'.padStart(8)}  ` +
      `${'loss n'.padStart(6)} ${'avg R'.padStart(7)} ${'total'.padStart(8)}  ` +
      `${'time n'.padStart(6)} ${'avg R'.padStart(7)} ${'total'.padStart(8)} ${'mins'.padStart(5)}`,
  );

  const pooled: BacktestTrade[] = [];

  for (const instrument of MARKETS) {
    try {
      const data = await loadHistory(instrument, days);
      const result = replay(instrument, data, { days, tuning: DEFAULT_TUNING });
      if (result.signals === 0) continue;
      pooled.push(...result.trades);

      const win = part(result.trades, 'WIN');
      const loss = part(result.trades, 'LOSS');
      const time = part(result.trades, 'TIMEOUT');

      console.log(
        `  ${instrument.label.padEnd(16)} ${result.avgRiskReward.toFixed(2).padStart(5)} ` +
          `${String(win.n).padStart(6)} ${win.r.toFixed(3).padStart(7)} ${win.total.toFixed(1).padStart(7)}R  ` +
          `${String(loss.n).padStart(6)} ${loss.r.toFixed(3).padStart(7)} ${loss.total.toFixed(1).padStart(7)}R  ` +
          `${String(time.n).padStart(6)} ${time.r.toFixed(3).padStart(7)} ${time.total.toFixed(1).padStart(7)}R ` +
          `${time.hold.toFixed(0).padStart(5)}`,
      );
    } catch (error) {
      console.log(`  ${instrument.label.padEnd(16)} unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (pooled.length === 0) return;

  const win = part(pooled, 'WIN');
  const loss = part(pooled, 'LOSS');
  const time = part(pooled, 'TIMEOUT');
  const total = pooled.reduce((sum, trade) => sum + trade.r, 0);

  console.log(`\n  ${pooled.length} trades pooled, ${total.toFixed(1)}R in total:\n`);
  for (const [name, split] of [['reached target', win], ['hit stop', loss], ['ran out of time', time]] as const) {
    console.log(
      `    ${name.padEnd(16)} ${String(split.n).padStart(4)} trades ` +
        `(${(split.share * 100).toFixed(0).padStart(2)}%)  ` +
        `${split.r.toFixed(3).padStart(7)}R each  ${split.total.toFixed(1).padStart(7)}R total`,
    );
  }

  // The question the whole table exists to answer: if the clock were not there
  // and the timed-out trades had never been taken, what would be left?
  console.log(
    `\n    without the timed-out trades: ${(win.total + loss.total).toFixed(1)}R over ${win.n + loss.n} trades` +
      ` (${((win.total + loss.total) / Math.max(1, win.n + loss.n)).toFixed(3)}R each)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
