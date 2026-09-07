import type { StrategyTuning } from '@/lib/config';
import { rangeOf } from '@/lib/indicators';
import { REGIME } from '@/lib/config';
import { nearestLevel, sign } from './strategies/shared';
import type { MarketContext, StrategyCandidate, TradePlan } from './types';

export type PlanResult = { ok: true; plan: TradePlan } | { ok: false; detail: string };

/**
 * Turns a proposed setup into concrete numbers.
 *
 * Scalping means the stop must be tight but never arbitrary: it sits just
 * beyond the level that invalidates the idea. The target is the nearest thing
 * price would realistically reach — a level, VWAP or a range edge — never a
 * distant number chosen to flatter the risk/reward.
 */
export function buildPlan(
  context: MarketContext,
  candidate: StrategyCandidate,
  tuning: StrategyTuning,
): PlanResult {
  const { setup, entry } = context.views;
  const s = sign(candidate.direction);
  const price = context.price;
  const format = (value: number) => value.toFixed(context.decimals);
  const round = (value: number) => Number(value.toFixed(context.decimals));

  // --- Entry ---------------------------------------------------------------
  const halfZone = 0.25 * entry.atr;

  // --- Stop ----------------------------------------------------------------
  let stopLoss = candidate.invalidation - s * tuning.stopBufferAtr * entry.atr;
  let risk = Math.abs(price - stopLoss);
  const minRisk = Math.max(tuning.minStopAtr * setup.atr, tuning.minRiskToSpread * context.spread);
  const maxRisk = tuning.maxStopAtr * setup.atr;

  let stopReason = `Stop ${format(round(stopLoss))} beyond the level that invalidates the setup`;
  if (risk < minRisk) {
    stopLoss = price - s * minRisk;
    risk = minRisk;
    stopReason = `Stop ${format(round(stopLoss))} widened to clear noise and spread`;
  }
  if (risk > maxRisk) {
    return { ok: false, detail: `the stop would sit ${(risk / setup.atr).toFixed(1)} ATR away, too wide to scalp` };
  }

  // --- Targets -------------------------------------------------------------
  const range = rangeOf(setup.candles, REGIME.rangeLookback);
  const opposing = nearestLevel(
    [...setup.levels, ...context.views.direction.levels],
    price,
    candidate.direction === 'LONG' ? 'resistance' : 'support',
  );

  const buffer = 0.2 * setup.atr;
  const raw = [
    candidate.preferredTarget,
    opposing ? opposing.price - s * buffer : undefined,
    context.vwap ?? undefined,
    candidate.direction === 'LONG' ? range.high - buffer : range.low + buffer,
  ];

  const ahead = raw
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .filter((value) => s * (value - price) > 0)
    .sort((a, b) => s * (a - b));

  const minReward = Math.max(tuning.minRiskReward * risk, tuning.minRewardToSpread * context.spread);
  const maxReward = tuning.maxTargetAtr * setup.atr;
  // Near enough to be reached in a scalp, far enough to be worth the spread.
  const takeProfit = ahead.find(
    (value) => Math.abs(value - price) >= minReward && Math.abs(value - price) <= maxReward,
  );

  if (takeProfit === undefined) {
    const nearest = ahead[0];
    const shortfall =
      nearest === undefined
        ? 'no target in front of price'
        : Math.abs(nearest - price) < minReward
          ? `nearest target only pays 1:${(Math.abs(nearest - price) / risk).toFixed(1)}`
          : `nearest target is ${(Math.abs(nearest - price) / setup.atr).toFixed(1)} ATR away, too far to scalp`;
    return { ok: false, detail: shortfall };
  }

  const takeProfit2 = ahead.find((value) => s * (value - takeProfit) > 0.3 * setup.atr) ?? null;
  const riskReward = Math.abs(takeProfit - price) / risk;

  return {
    ok: true,
    plan: {
      entryLow: round(price - halfZone),
      entryHigh: round(price + halfZone),
      entry: round(price),
      stopLoss: round(stopLoss),
      takeProfit: round(takeProfit),
      takeProfit2: takeProfit2 === null ? null : round(takeProfit2),
      riskReward: Number(riskReward.toFixed(2)),
      stopReason,
      targetReason: `First target ${format(round(takeProfit))} at the nearest level price can realistically reach`,
    },
  };
}
