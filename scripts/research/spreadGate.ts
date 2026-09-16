/**
 * How much of the stop the spread is allowed to be.
 *
 * Three separate studies now agree on the same arithmetic, and it is the only
 * finding in this repository that has never once failed to replicate. The
 * opening-range test measured it most cleanly: with a five-minute range the
 * round trip came to 0.334 of the risk and the rule returned -0.389R; with a
 * thirty-minute range the round trip fell to 0.138 and the return rose to
 * -0.154R; and sliced by cost directly, trades paying under a tenth of their
 * risk returned -0.033R while those paying over a quarter returned -1.03R. The
 * result tracks the toll almost exactly, which is what it looks like when the
 * prediction is worth nothing and the spread is the entire outcome.
 *
 * The live engine has carried a lever for this since the beginning —
 * `minRiskToSpread`, the number of times the stop distance must cover the
 * round trip — and it has been set to 3 the whole time. Three means the spread
 * may be a third of the risk, which is precisely the regime the measurements
 * call the expensive one.
 *
 * Raising it is not free: a stop wide enough to make the spread small is a stop
 * that has to be reached, and `maxStopAtr` caps how far it may sit, so the two
 * have to move together or the gate simply rejects everything. That trade —
 * fewer signals, each costing less — is what this sweeps, and it reports the
 * signal count beside every result because a configuration that never trades
 * has an excellent expectancy and earns nothing.
 *
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/research/spreadGate.ts [days]
 */
import { DEFAULT_TUNING, INSTRUMENTS } from '@/lib/config';
import { replay, type BacktestData, type BacktestResult } from '@/lib/backtest/engine';
import { loadHistory } from '../lib/data';

const days = Number(process.argv[2] ?? 21);

/** How many times the stop distance must cover the round trip. */
const RISK_TO_SPREAD = [3, 4, 5, 6, 8, 10];

/** How far the stop is allowed to sit, in setup-frame ATRs. */
const MAX_STOP_ATR = [2.6, 4, 6];

const SAMPLES: { name: string; range: [number, number] }[] = [
  { name: 'first half', range: [0, 0.5] },
  { name: 'second half', range: [0.5, 1] },
];

const cell = (result: BacktestResult) =>
  `${String(result.signals).padStart(4)} ${result.expectancy.toFixed(3).padStart(7)}R ${result.totalR.toFixed(1).padStart(7)}R`;

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of INSTRUMENTS) {
    data.set(instrument.id, await loadHistory(instrument, days));
  }

  for (const instrument of INSTRUMENTS) {
    console.log(`\n================ ${instrument.label} ================`);
    console.log(
      `  ${'gate'.padEnd(18)} ${'first half'.padEnd(22)}  ${'second half'.padEnd(22)}  both halves`,
    );

    for (const maxStopAtr of MAX_STOP_ATR) {
      for (const minRiskToSpread of RISK_TO_SPREAD) {
        const tuning = { ...DEFAULT_TUNING, minRiskToSpread, maxStopAtr };
        const results = SAMPLES.map(({ range }) =>
          replay(instrument, data.get(instrument.id)!, { days, tuning, sample: range }),
        );

        // A configuration only counts if it pays on both halves and actually
        // traded on both: a gate that issues four signals can post any number.
        const traded = results.every((result) => result.signals >= 5);
        const survives = traded && results.every((result) => result.totalR > 0);

        console.log(
          `  ${`x${minRiskToSpread} stop<=${maxStopAtr}`.padEnd(18)} ${cell(results[0])}  ${cell(results[1])}  ` +
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
