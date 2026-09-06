/** How much of the session each market regime accounts for. */
import { loadHistory } from './data';
import { CANDLE_DEPTH, INSTRUMENTS, TIMEFRAME_ROLES, type Regime, type TimeframeRole } from '@/lib/config';

import { closedBefore, type Candle } from '@/lib/market/candles';
import { buildContext, decide } from '@/lib/strategy';

const days = Number(process.argv[2] ?? 6);
const window = (series: Candle[], size: number) => (series.length > size ? series.slice(-size) : series);

async function main() {
  for (const instrument of INSTRUMENTS) {
    const { decimals, candles } = await loadHistory(instrument, days);
    const entryCandles = candles.entry;
    const start = Math.max(CANDLE_DEPTH.entry, entryCandles.length - days * 1440);

    const regimeCounts = new Map<Regime, number>();
    const blockCounts = new Map<string, number>();
    let evaluated = 0;
    let signals = 0;

    for (let i = start; i < entryCandles.length - 1; i += 1) {
      const now = entryCandles[i].closeTime;
      const bar = entryCandles[i];
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

      evaluated += 1;
      regimeCounts.set(context.regime, (regimeCounts.get(context.regime) ?? 0) + 1);
      const decision = decide(context);
      if (decision.type === 'WAIT') {
        blockCounts.set(decision.blockedBy ?? '?', (blockCounts.get(decision.blockedBy ?? '?') ?? 0) + 1);
      } else {
        signals += 1;
      }
    }

    console.log(`\n===== ${instrument.label} — ${evaluated} bars, ${signals} raw signals =====`);
    for (const [regime, count] of [...regimeCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${regime.padEnd(20)} ${((count / evaluated) * 100).toFixed(1)}%`);
    }
    console.log('  blocked by:');
    for (const [reason, count] of [...blockCounts].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      console.log(`    ${reason.padEnd(46)} ${((count / evaluated) * 100).toFixed(1)}%`);
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
