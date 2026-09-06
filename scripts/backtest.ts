/** CLI: npx tsx --env-file=.env.local scripts/backtest.ts [days] */
import { INSTRUMENTS } from '@/lib/config';
import { runBacktest } from '@/lib/backtest/engine';

const days = Number(process.argv[2] ?? 5);
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

async function main() {
  for (const instrument of INSTRUMENTS) {
    const result = await runBacktest(instrument, { days });
    console.log(`\n===== ${result.label} | ${stamp(result.from)} → ${stamp(result.to)} =====`);
    console.log(
      `bars ${result.barsTested} | signals ${result.signals} (${(result.signals / Math.max(result.barsTested / 60, 1)).toFixed(2)}/h) | ` +
        `W/L ${result.wins}/${result.losses} | timeouts ${result.timeouts}`,
    );
    console.log(
      `win rate ${result.winRate}% | avg RR 1:${result.avgRiskReward} | avg hold ${result.avgHoldMinutes}m | ` +
        `avg score ${result.avgScore} | total ${result.totalR}R | expectancy ${result.expectancy}R | PF ${result.profitFactor ?? '—'}`,
    );
    if (result.byStrategy.length > 0) {
      console.log('\n  strategy              n    W/L      win%    RR    totalR   exp');
      for (const s of result.byStrategy) {
        console.log(
          `  ${s.strategy.padEnd(20)} ${String(s.signals).padStart(3)}  ${String(s.wins).padStart(3)}/${String(s.losses).padEnd(3)} ${String(s.winRate).padStart(6)}%  1:${s.avgRiskReward.toFixed(2)} ${s.totalR.toFixed(1).padStart(7)}R ${s.expectancy.toFixed(3).padStart(7)}`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
