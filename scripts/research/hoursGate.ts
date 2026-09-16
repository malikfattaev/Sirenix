/**
 * Which hours of the day are worth issuing a signal in.
 *
 * `tradingHours.ts` measured the raw arithmetic on fifteen-minute candles: the
 * round trip costs about the same all day — between 0.073 and 0.151 of an ATR —
 * while the distance a market travels in a quarter of an hour swings from 0.39
 * ATR at nine in the evening to 1.27 at two in the afternoon. The ratio of the
 * two, which is how much room a trade has to pay for itself, runs from 2.6 to
 * 17.3. Nothing about that is a forecast; it is the same spread measured
 * against three times the movement.
 *
 * This asks what the live engine does with it. The windows below are the shapes
 * that ratio suggests rather than a grid to be searched: the London and New
 * York overlap where it peaks, each session on its own, the whole working day,
 * and the current behaviour of trading around the clock for comparison. A
 * finding has to pay on both halves of the history and to have traded enough
 * times on each to mean anything, because a window narrow enough to take four
 * trades can post any number at all.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/hoursGate.ts [days]
 */
import { DEFAULT_TUNING, INSTRUMENTS, type StrategyTuning } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';

const days = Number(process.argv[2] ?? 21);

const WINDOWS: { name: string; hours: StrategyTuning['tradingHours'] }[] = [
  { name: 'around the clock', hours: null },
  { name: 'London 07-16', hours: { from: 7, to: 16 } },
  { name: 'overlap 12-16', hours: { from: 12, to: 16 } },
  { name: 'NY open 13-16', hours: { from: 13, to: 16 } },
  { name: 'NY cash 13-20', hours: { from: 13, to: 20 } },
  { name: 'working day 07-20', hours: { from: 7, to: 20 } },
  { name: 'morning 07-12', hours: { from: 7, to: 12 } },
];

/** The gate the spread sweep picked, so the two changes are measured together. */
const RISK_TO_SPREAD = [3, 6];

const SAMPLES: [number, number][] = [[0, 0.5], [0.5, 1]];

const cell = (result: BacktestResult) =>
  `${String(result.signals).padStart(4)} ${result.expectancy.toFixed(3).padStart(7)}R ${result.totalR.toFixed(1).padStart(7)}R`;

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of INSTRUMENTS) {
    data.set(instrument.id, await loadHistory(instrument, days));
  }

  for (const minRiskToSpread of RISK_TO_SPREAD) {
    console.log(`\n############ risk must cover the spread ${minRiskToSpread}x ############`);

    for (const instrument of INSTRUMENTS) {
      console.log(`\n  ================ ${instrument.label} ================`);
      console.log(`    ${'window'.padEnd(18)} ${'first half'.padEnd(22)}  ${'second half'.padEnd(22)}  both`);

      for (const { name, hours } of WINDOWS) {
        const tuning = { ...DEFAULT_TUNING, minRiskToSpread, tradingHours: hours };
        const results = SAMPLES.map((sample) =>
          replay(instrument, data.get(instrument.id)!, { days, tuning, sample }),
        );
        const traded = results.every((result) => result.signals >= 5);
        const survives = traded && results.every((result) => result.totalR > 0);

        console.log(
          `    ${name.padEnd(18)} ${cell(results[0])}  ${cell(results[1])}  ` +
            `${(results[0].totalR + results[1].totalR).toFixed(1).padStart(7)}R` +
            (survives ? '  <-- SURVIVES' : ''),
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
