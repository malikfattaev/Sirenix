/** Live smoke test: pulls real data and prints the full read for each instrument. */
import { capital } from '@/lib/capital/client';
import { CANDLE_DEPTH, INSTRUMENTS, TIMEFRAME_ROLES, type TimeframeRole } from '@/lib/config';
import { toCandles, type Candle } from '@/lib/market/candles';
import { buildContext, decide } from '@/lib/strategy';

async function main() {
  for (const instrument of INSTRUMENTS) {
    const [market, raw] = await Promise.all([
      capital.getMarket(instrument.epic),
      capital.getCandlesForRoles(instrument.epic, TIMEFRAME_ROLES, CANDLE_DEPTH),
    ]);
    const candles = Object.fromEntries(
      (Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]).map((role) => [
        role,
        toCandles(raw[role], TIMEFRAME_ROLES[role]),
      ]),
    ) as Record<TimeframeRole, Candle[]>;

    const { bid, offer, decimalPlacesFactor: decimals, marketStatus } = market.snapshot;
    const price = bid !== null && offer !== null ? (bid + offer) / 2 : candles.entry.at(-1)!.close;
    const context = buildContext({
      instrumentId: instrument.id,
      candles,
      price,
      bid,
      ask: offer,
      spread: bid !== null && offer !== null ? offer - bid : candles.entry.at(-1)!.spread,
      decimals,
      marketStatus,
      now: Date.now(),
    });

    console.log(`\n===== ${instrument.label} (${instrument.epic}) =====`);
    if (!context) {
      console.log('not enough data');
      continue;
    }

    for (const role of Object.keys(TIMEFRAME_ROLES) as TimeframeRole[]) {
      const view = context.views[role];
      console.log(
        `${view.label.padEnd(4)} n=${String(view.candles.length).padStart(3)} close=${view.close.toFixed(decimals)} ` +
          `ema9=${view.ema9.toFixed(decimals)} ema20=${view.ema20.toFixed(decimals)} ema50=${view.ema50?.toFixed(decimals) ?? '—'} ` +
          `rsi=${view.rsi.toFixed(1)} atr=${view.atr.toFixed(3)} (x${view.atrRatio.toFixed(2)}) struct=${view.structure} levels=${view.levels.length}`,
      );
    }

    console.log(
      `\nprice ${price.toFixed(decimals)} spread ${context.spread.toFixed(decimals)} | vwap ${context.vwap?.toFixed(decimals) ?? '—'} | ${marketStatus}`,
    );
    console.log(`regime ${context.regime} — ${context.regimeReason}`);

    const decision = decide(context);
    console.log(`--> ${decision.type} ${decision.strategyLabel ?? ''} score ${decision.score}/100`);
    if (decision.plan) console.log('plan:', JSON.stringify(decision.plan));
    console.log('reasons:' + decision.reasons.map((reason) => `\n  - ${reason}`).join(''));
    if (decision.components.length > 0) {
      console.log('components:', decision.components.map((c) => `${c.key}=${c.value.toFixed(2)}`).join(' '));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
