/**
 * Edge test: do the entries predict direction, and what does the spread cost?
 *
 * Measures the forward move after every signal, in 5m ATR units, against the
 * drift of the market itself over the same horizon. A system with no edge
 * matches the baseline; the spread then turns "no edge" into a loss.
 * Usage: npx tsx --env-file=.env.local scripts/research/edge.ts <days>
 */
import { loadHistory } from '../lib/data';
import { CANDLE_DEPTH, DEFAULT_TUNING, INSTRUMENTS, type StrategyKey, type TimeframeRole } from '@/lib/config';

import { closedBefore, type Candle } from '@/lib/market/candles';
import { buildContext, decide } from '@/lib/strategy';

const days = Number(process.argv[2] ?? 21);
const HORIZONS = [5, 10, 20, 40, 60];

const window = (series: Candle[], size: number) => (series.length > size ? series.slice(-size) : series);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

interface Observation {
  strategy: StrategyKey;
  /** Forward move in the signal's direction, in 5m ATR, per horizon. */
  forward: number[];
  /** Round-trip spread as a fraction of the same 5m ATR. */
  spreadCost: number;
}

async function main() {
  for (const instrument of INSTRUMENTS) {
    const { decimals, candles } = await loadHistory(instrument, days);
    const entryCandles = candles.entry;
    const start = Math.max(CANDLE_DEPTH.entry, entryCandles.length - days * 1440);
    const horizonMax = Math.max(...HORIZONS);

    const observations: Observation[] = [];
    const baseline: number[][] = HORIZONS.map(() => []);

    for (let i = start; i < entryCandles.length - horizonMax; i += 1) {
      const bar = entryCandles[i];
      const now = bar.closeTime;
      const context = buildContext({
        instrumentId: instrument.id,
        candles: {
          context: window(closedBefore(candles.context, now), CANDLE_DEPTH.context),
          direction: window(closedBefore(candles.direction, now), CANDLE_DEPTH.direction),
          setup: window(closedBefore(candles.setup, now), CANDLE_DEPTH.setup),
          entry: window(entryCandles.slice(0, i + 1), CANDLE_DEPTH.entry),
        } as Record<TimeframeRole, Candle[]>,
        price: bar.close,
        bid: bar.close - bar.spread / 2,
        ask: bar.close + bar.spread / 2,
        spread: bar.spread,
        decimals,
        marketStatus: 'TRADEABLE',
        now,
      });
      if (!context) continue;

      const atr = context.views.setup.atr;
      HORIZONS.forEach((horizon, h) =>
        baseline[h].push((entryCandles[i + horizon].close - bar.close) / atr),
      );

      const decision = decide(context, DEFAULT_TUNING);
      if (decision.type === 'WAIT' || !decision.strategy) continue;
      const sign = decision.type === 'LONG' ? 1 : -1;
      observations.push({
        strategy: decision.strategy,
        forward: HORIZONS.map((h) => (sign * (entryCandles[i + h].close - bar.close)) / atr),
        spreadCost: bar.spread / atr,
      });
    }

    console.log(`\n===== ${instrument.label}: ${observations.length} signal bars =====`);
    console.log(`round-trip spread = ${(mean(observations.map((o) => o.spreadCost)) * 100).toFixed(1)}% of one 5m ATR`);
    console.log('\nhorizon   signal(ATR)  baseline(ATR)   edge   hit-rate');
    HORIZONS.forEach((horizon, h) => {
      const moves = observations.map((o) => o.forward[h]);
      const hit = moves.length ? (moves.filter((m) => m > 0).length / moves.length) * 100 : 0;
      const edge = mean(moves) - Math.abs(mean(baseline[h]));
      console.log(
        `${String(horizon + 'm').padEnd(9)} ${mean(moves).toFixed(3).padStart(11)} ${mean(baseline[h]).toFixed(3).padStart(14)} ${edge.toFixed(3).padStart(7)} ${hit.toFixed(1).padStart(10)}%`,
      );
    });

    console.log('\nper strategy, forward move at 20m (ATR):');
    for (const strategy of [...new Set(observations.map((o) => o.strategy))]) {
      const subset = observations.filter((o) => o.strategy === strategy);
      const moves = subset.map((o) => o.forward[2]);
      const hit = (moves.filter((m) => m > 0).length / moves.length) * 100;
      console.log(
        `  ${strategy.padEnd(18)} n=${String(subset.length).padStart(4)} move=${mean(moves).toFixed(3).padStart(7)} hit=${hit.toFixed(1).padStart(5)}%`,
      );
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
