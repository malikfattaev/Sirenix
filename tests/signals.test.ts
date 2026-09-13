import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INSTRUMENTS, INTRADAY, intradayTuning } from '@/lib/config';
import { analyseIntraday, readIntraday } from '@/lib/intraday';
import { candleExit } from '@/lib/intraday/replay';
import type { Candle } from '@/lib/market/candles';
import type { Quote } from '@/lib/quotes';

const gold = INSTRUMENTS[0];
const now = 1_800_000_000_000;
function bars(side: number): Candle[] {
  return Array.from({ length: 80 }, (_, i) => {
    const close = 2000 + side * i * 2;
    return { time: now - (80 - i) * 900_000, closeTime: now - (79 - i) * 900_000,
      open: close - side, close, high: close + 1, low: close - 1, spread: 2, volume: 10 };
  });
}
function quote(price: number): Quote {
  return { instrumentId: gold.id, price, bid: price - 1, ask: price + 1, spread: 2,
    decimals: 2, marketStatus: 'TRADEABLE', updatedAt: now, changePercent: 0,
    source: 'stream', open: true, stale: false, age: 0, opensAt: null, closesAt: null };
}

for (const side of [1, -1]) {
  test(`intraday ${side === 1 ? 'LONG buys ask' : 'SHORT sells bid'} and anchors levels to fill`, () => {
    const candles = bars(side);
    const q = quote(candles.at(-1)!.close);
    const signal = analyseIntraday(gold, candles, q, now);
    const atr = readIntraday(candles)!.atr;
    assert.equal(signal.type, side === 1 ? 'LONG' : 'SHORT');
    assert.equal(signal.price, q.price);
    assert.equal(signal.plan!.entry, side === 1 ? q.ask : q.bid);
    assert.equal(signal.plan!.stopLoss, +(signal.plan!.entry - side * INTRADAY.stopAtr * atr).toFixed(2));
    assert.equal(signal.plan!.takeProfit, +(signal.plan!.entry + side * INTRADAY.targetAtr * atr).toFixed(2));
    assert.equal(signal.plan!.riskReward, +(Math.abs(signal.plan!.takeProfit - signal.plan!.entry) /
      Math.abs(signal.plan!.stopLoss - signal.plan!.entry)).toFixed(2));
  });
}

test('missing, crossed and nonfinite quotes cannot produce an entry', () => {
  const candles = bars(1);
  const q = quote(candles.at(-1)!.close);
  for (const invalid of [undefined, { ...q, ask: null }, { ...q, bid: NaN }, { ...q, bid: q.ask! + 1 }]) {
    const signal = analyseIntraday(gold, candles, invalid, now);
    assert.equal(signal.type, 'WAIT');
    assert.equal(signal.plan, null);
  }
});

test('profiles are separate and analysis uses supplied instrument tuning', () => {
  assert.notEqual(intradayTuning('GOLD'), intradayTuning('BRENT'));
  const candles = bars(1);
  const q = quote(candles.at(-1)!.close);
  const normal = analyseIntraday(gold, candles, q, now);
  const strict = analyseIntraday(gold, candles, q, now, { ...intradayTuning('GOLD'), threshold: 100 });
  assert.equal(normal.type, 'LONG');
  assert.equal(strict.type, 'WAIT');
  assert.equal(strict.rejections![0].code, 'strength');
});

test('replay checks the exit side and charges the spread only once', () => {
  const plan = analyseIntraday(gold, bars(1), quote(2158), now).plan!;
  const target = plan.takeProfit;
  const bar = { ...bars(1)[0], open: target - 2, low: target - 2, high: target + 0.5, close: target, spread: 2 };
  assert.equal(candleExit(plan, 'LONG', bar), null);
  assert.deepEqual(candleExit(plan, 'LONG', { ...bar, high: target + 1 }), { status: 'WIN', price: target });
  const both = { ...bar, low: plan.stopLoss, high: target + 1 };
  assert.equal(candleExit(plan, 'LONG', both)!.status, 'LOSS');
  assert.equal(candleExit(plan, 'LONG', { ...both, open: plan.stopLoss - 2 })!.price, plan.stopLoss - 3);
  const shortPlan = analyseIntraday(gold, bars(-1), quote(1842), now).plan!;
  const shortBar = { ...bar, open: shortPlan.takeProfit + 2, high: shortPlan.takeProfit + 2, low: shortPlan.takeProfit - 0.5 };
  assert.equal(candleExit(shortPlan, 'SHORT', shortBar), null);
  assert.deepEqual(candleExit(shortPlan, 'SHORT', { ...shortBar, low: shortPlan.takeProfit - 1 }),
    { status: 'WIN', price: shortPlan.takeProfit });
});

let journal: typeof import('@/lib/db/skips');
let database: typeof import('@/lib/db/connection');
const directory = mkdtempSync(path.join(tmpdir(), 'sirenix-tests-'));
before(async () => {
  process.env.DATABASE_PATH = path.join(directory, 'test.db');
  process.env.SETTINGS_PATH = path.join(directory, 'settings.json');
  journal = await import('@/lib/db/skips');
  database = await import('@/lib/db/connection');
});
after(() => { database.connection().close(); rmSync(directory, { recursive: true, force: true }); });

test('journal persists WAIT snapshots, deduplicates polls and keeps markets/horizons separate', () => {
  const signal = analyseIntraday(gold, bars(1), quote(2158), now, { ...INTRADAY, threshold: 100 });
  journal.recordSkip(signal);
  journal.recordSkip({ ...signal, updatedAt: now + 1000 });
  journal.recordSkip({ ...signal, instrumentId: 'BRENT' });
  journal.recordSkip({ ...signal, horizon: 'scalp' });
  journal.recordSkip({ ...signal, updatedAt: now + 60_000 });
  journal.recordSkip(analyseIntraday(gold, bars(1), quote(2158), now));
  assert.equal(journal.recentSkips(100).length, 4);
  assert.equal(journal.skipSummary(now).find((r) => r.instrumentId === 'GOLD' && r.horizon === 'intraday')!.samples, 2);
  assert.equal(journal.recentSkips(1)[0].signal.bid, 2157);
});

test('cooldown journal preserves the rejected direction, score and plan', async () => {
  const { recordSignal } = await import('@/lib/db');
  const { withPosition } = await import('@/lib/position');
  const candidate = analyseIntraday(gold, bars(1), quote(2158), now);
  const recorded = recordSignal(candidate)!;
  database.connection().prepare("UPDATE signals SET status = 'LOSS', result_r = -1, closed_at = ? WHERE id = ?")
    .run(now, recorded.id);
  const rejected = withPosition({ ...candidate, updatedAt: now + 120_000 });
  assert.equal(rejected.type, 'WAIT');
  assert.equal(rejected.plan, null);
  assert.equal(rejected.rejections![0].code, 'loss_cooldown');
  assert.equal(rejected.rejections![0].direction, 'LONG');
  assert.deepEqual(rejected.rejections![0].plan, candidate.plan);
  journal.recordSkip(rejected);
  assert.equal(journal.recentSkips(1)[0].signal.rejections![0].score, candidate.score);
});
