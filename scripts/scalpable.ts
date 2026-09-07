/**
 * Which markets are cheap enough to scalp.
 *
 * A scalp has to clear the round-trip spread out of a one-minute move, so the
 * only ratio that matters is spread divided by one-minute ATR. Gold sits at
 * 0.29 and Brent at 0.74; anything above roughly 0.5 is paying most of the
 * move away before the idea has a chance.
 *
 * Reports the movement available per minute alongside it, because a market can
 * be cheap and still too quiet to be worth trading.
 *
 * Usage: npx tsx --env-file=.env.local scripts/scalpable.ts
 */
import { capital } from '@/lib/capital/client';
import { atr as atrSeries, lastValue, median } from '@/lib/indicators';
import { toCandles } from '@/lib/market/candles';
import { UNIVERSE } from './universe';

const BARS = 1000;

/** Commodities beyond the research universe, since that is what was asked about. */
const EXTRA: { epic: string; type: string }[] = [
  'ALUMINIUM', 'ZINC', 'NICKEL', 'LEAD', 'TIN', 'WHEAT', 'CORN', 'SOYBEAN',
  'SUGARNO11', 'COFFEE', 'COCOA', 'COTTON', 'HEATINGOIL', 'SILVER_MINI', 'GOLD_MINI',
  'ORANGEJUICE', 'LUMBER', 'OATS', 'RICE', 'LIVECATTLE', 'LEANHOGS', 'URANIUM',
].map((epic) => ({ epic, type: 'COMMODITIES' }));

interface Row {
  epic: string;
  type: string;
  price: number;
  spread: number;
  atr: number;
  /** Spread as a multiple of one-minute ATR: the cost of one round trip. */
  cost: number;
  /** One-minute ATR as a percentage of price: how much there is to catch. */
  movePercent: number;
  bars: number;
}

async function main() {
  const targets = [...UNIVERSE, ...EXTRA];
  console.log(`Measuring ${targets.length} markets on 1-minute candles...\n`);

  const rows: Row[] = [];
  for (const target of targets) {
    try {
      const candles = toCandles(await capital.getCandles(target.epic, 'MINUTE', BARS), 'MINUTE');
      if (candles.length < 200) continue;

      const atr = lastValue(atrSeries(candles, 14));
      if (!atr || atr <= 0) continue;

      // The typical quoted spread, not the current one, which can be a spike.
      const spread = median(candles.slice(-300).map((candle) => candle.spread));
      const price = candles[candles.length - 1].close;
      rows.push({
        epic: target.epic,
        type: target.type,
        price,
        spread,
        atr,
        cost: spread / atr,
        movePercent: (atr / price) * 100,
        bars: candles.length,
      });
    } catch {
      // An epic the broker does not quote simply drops out.
    }
  }

  rows.sort((a, b) => a.cost - b.cost);
  console.log(
    `${'epic'.padEnd(18)} ${'type'.padEnd(12)} ${'price'.padStart(10)} ${'spread'.padStart(9)} ` +
      `${'1m ATR'.padStart(9)} ${'cost'.padStart(6)} ${'move%'.padStart(7)}`,
  );
  for (const row of rows) {
    const mark = row.epic === 'GOLD' || row.epic === 'OIL_BRENT' ? ' <-- on the board' : '';
    console.log(
      `${row.epic.padEnd(18)} ${row.type.padEnd(12)} ${row.price.toFixed(4).padStart(10)} ` +
        `${row.spread.toFixed(4).padStart(9)} ${row.atr.toFixed(4).padStart(9)} ` +
        `${row.cost.toFixed(2).padStart(6)} ${row.movePercent.toFixed(3).padStart(7)}${mark}`,
    );
  }

  const cheaper = rows.filter((row) => row.cost < 0.29);
  console.log(`\n${cheaper.length} markets cost less per round trip than gold does.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
