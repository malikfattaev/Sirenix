import type { StrategyTuning } from '@/lib/config';
import { rangeOf } from '@/lib/indicators';
import { REGIME } from '@/lib/config';
import { nearestLevel, sign } from './strategies/shared';
import type { MarketContext, StrategyCandidate, TradePlan } from './types';

export type PlanResult = { ok: true; plan: TradePlan } | { ok: false; code: 'spread' | 'risk' | 'target'; detail: string };

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
  // Levels are read off the mid, but the fill is on the other side of the book:
  // a buy pays the ask. Quoting the mid as the entry understates the risk and
  // overstates the reward by half a spread each, every trade.
  const fill = price + (s * context.spread) / 2;
  const halfZone = 0.25 * entry.atr;

  // --- Stop ----------------------------------------------------------------
  let stopLoss = candidate.invalidation - s * tuning.stopBufferAtr * entry.atr;
  let risk = Math.abs(fill - stopLoss);
  const minRisk = Math.max(tuning.minStopAtr * setup.atr, tuning.minRiskToSpread * context.spread);
  const maxRisk = tuning.maxStopAtr * setup.atr;

  let stopReason = `Стоп ${format(round(stopLoss))} за уровнем, который отменяет сетап`;
  if (risk < minRisk) {
    stopLoss = fill - s * minRisk;
    risk = minRisk;
    stopReason = `Стоп ${format(round(stopLoss))} расширен, чтобы вынести шум и спред`;
  }
  if (risk > maxRisk) {
    return { ok: false, code: tuning.minRiskToSpread * context.spread > maxRisk ? 'spread' : 'risk',
      detail: `стоп встал бы в ${(risk / setup.atr).toFixed(1)} ATR, слишком далеко для скальпа` };
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
    (value) => Math.abs(value - fill) >= minReward && Math.abs(value - fill) <= maxReward,
  );

  if (takeProfit === undefined) {
    const nearest = ahead[0];
    const shortfall =
      nearest === undefined
        ? 'впереди цены нет цели'
        : Math.abs(nearest - price) < minReward
          ? `ближайшая цель даёт только 1:${(Math.abs(nearest - fill) / risk).toFixed(1)}`
          : `ближайшая цель в ${(Math.abs(nearest - fill) / setup.atr).toFixed(1)} ATR, слишком далеко для скальпа`;
    return { ok: false, code: tuning.minRewardToSpread * context.spread > maxReward ? 'spread' : 'target', detail: shortfall };
  }

  const takeProfit2 = ahead.find((value) => s * (value - takeProfit) > 0.3 * setup.atr) ?? null;
  const riskReward = Math.abs(takeProfit - fill) / risk;

  return {
    ok: true,
    plan: {
      entryLow: round(fill - halfZone),
      entryHigh: round(fill + halfZone),
      entry: round(fill),
      stopLoss: round(stopLoss),
      takeProfit: round(takeProfit),
      takeProfit2: takeProfit2 === null ? null : round(takeProfit2),
      riskReward: Number(riskReward.toFixed(2)),
      stopReason,
      targetReason: `Первая цель ${format(round(takeProfit))} на ближайшем уровне, до которого цена реально дойдёт`,
    },
  };
}
