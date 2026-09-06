/**
 * How often a signal actually appears: gaps between them, per-day counts and
 * the spread across the trading day.
 * Usage: npx tsx --env-file=.env.local scripts/frequency.ts <days>
 */
import { CANDLE_DEPTH, DEFAULT_TUNING, INSTRUMENTS, type TimeframeRole } from '@/lib/config';
import { loadBacktestData } from '@/lib/backtest/engine';
import { closedBefore, type Candle } from '@/lib/market/candles';
import { buildContext, decide } from '@/lib/strategy';

const days = Number(process.argv[2] ?? 6);
const window = (series: Candle[], size: number) => (series.length > size ? series.slice(-size) : series);
const HOUR_MS = 3_600_000;

async function main() {
  for (const instrument of INSTRUMENTS) {
    const { decimals, candles } = await loadBacktestData(instrument, days);
    const entryCandles = candles.entry;
    const start = Math.max(CANDLE_DEPTH.entry, entryCandles.length - days * 1440);

    const fired: number[] = [];
    const byHour = new Array(24).fill(0);
    const byDay = new Map<string, number>();
    let quietBar = start;

    for (let i = start; i < entryCandles.length - 1; i += 1) {
      if (i < quietBar) continue;
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

      if (decide(context).type !== 'WAIT') {
        fired.push(now);
        byHour[new Date(now).getUTCHours()] += 1;
        const day = new Date(now).toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
        // One setup is one signal: skip the trade window plus the cooldown.
        quietBar = i + DEFAULT_TUNING.maxHoldMinutes + DEFAULT_TUNING.cooldownBars;
      }
    }

    const gaps = fired.slice(1).map((time, index) => (time - fired[index]) / HOUR_MS);
    gaps.sort((a, b) => a - b);
    const covered = (entryCandles.at(-1)!.closeTime - entryCandles[start].closeTime) / HOUR_MS;

    console.log(`\n===== ${instrument.label} =====`);
    console.log(
      `${fired.length} signals over ${covered.toFixed(0)}h of market time ` +
        `(${(fired.length / (covered / 24)).toFixed(1)} per 24h of open market)`,
    );
    if (gaps.length > 0) {
      console.log(
        `gap between signals: median ${gaps[Math.floor(gaps.length / 2)].toFixed(1)}h, ` +
          `shortest ${gaps[0].toFixed(1)}h, longest ${gaps.at(-1)!.toFixed(1)}h`,
      );
    }
    console.log('per calendar day:', [...byDay.entries()].map(([d, n]) => `${d.slice(5)}=${n}`).join(' '));
    const busiest = byHour
      .map((count, hour) => ({ hour, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    console.log('busiest hours (UTC):', busiest.map((e) => `${String(e.hour).padStart(2, '0')}:00=${e.count}`).join(' '));
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
