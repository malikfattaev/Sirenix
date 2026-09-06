import type { ScoreComponent, MarketContext, StrategyCandidate, TradePlan } from './types';
import { clamp, entryConfirmation, nearestLevel, plateau, sign, trendVote } from './strategies/shared';
import { DEFAULT_TUNING, type StrategyTuning } from '@/lib/config';

/**
 * Scores a proposed setup on the confluence of everything the system tracks.
 *
 * A high score means many independent factors line up — it is deliberately not
 * a probability of winning, and nothing here can turn a bad setup into a good
 * one on the strength of a single component.
 */
export function scoreSetup(
  context: MarketContext,
  candidate: StrategyCandidate,
  plan: TradePlan | null,
  tuning: StrategyTuning = DEFAULT_TUNING,
): { score: number; components: ScoreComponent[] } {
  const { direction: higher, setup, entry, context: hourly } = context.views;
  const s = sign(candidate.direction);

  const directionVote = s * trendVote(higher);
  const setupVote = s * trendVote(setup);
  const hourlyVote = s * trendVote(hourly);

  // Structure on the setup frame, softened when the higher frame disagrees.
  const wanted = candidate.direction === 'LONG' ? 'up' : 'down';
  const structureValue =
    setup.structure === wanted ? 1 : setup.structure === 'range' ? 0.5 : 0.1;

  const vwapValue =
    context.vwap === null
      ? 0.5
      : plateau((s * (context.price - context.vwap)) / setup.atr, -1.6, -0.2, 1.6, 3.5);

  const emaValue = clamp(Math.abs(setup.ema9 - setup.ema20) / (0.8 * setup.atr), 0, 1);

  const supporting = nearestLevel(
    [...setup.levels, ...higher.levels],
    context.price,
    candidate.direction === 'LONG' ? 'support' : 'resistance',
  );
  const blocking = nearestLevel(
    [...setup.levels, ...higher.levels],
    context.price,
    candidate.direction === 'LONG' ? 'resistance' : 'support',
  );
  const supportValue = supporting
    ? supporting.strength * plateau(Math.abs(context.price - supporting.price) / setup.atr, -0.1, 0, 1.4, 3.5)
    : 0.3;
  const blockPenalty = blocking
    ? clamp(Math.abs(blocking.price - context.price) / (1.2 * setup.atr), 0.2, 1)
    : 1;

  const relativeRsi = candidate.direction === 'LONG' ? setup.rsi : 100 - setup.rsi;
  const momentumValue = plateau(relativeRsi, 25, 45, 72, 88);

  const volatilityValue =
    plateau(entry.atrRatio, 0.45, 0.8, 1.6, 2.4) * plateau(setup.atrPercent, 0.005, 0.02, 0.6, 1.6);

  // Entry quality: how much of the move is already gone.
  const chased = Math.abs(context.price - candidate.triggerPrice) / entry.atr;
  const entryValue = plateau(chased, -0.1, 0, tuning.maxChaseAtr * 0.5, tuning.maxChaseAtr);

  const riskRewardValue = plan
    ? clamp((plan.riskReward - tuning.minRiskReward) / (3 - tuning.minRiskReward), 0, 1)
    : 0.4;

  const components: ScoreComponent[] = [
    { key: 'direction15m', label: '15m direction', weight: 12, value: clamp((directionVote + 1) / 2, 0, 1) },
    { key: 'trend5m', label: '5m trend', weight: 12, value: clamp((setupVote + 1) / 2, 0, 1) },
    { key: 'confirm1m', label: '1m confirmation', weight: 12, value: entryConfirmation(entry, candidate.direction) },
    { key: 'structure', label: 'Market structure', weight: 9, value: structureValue },
    { key: 'vwap', label: 'VWAP', weight: 9, value: vwapValue },
    { key: 'ema', label: 'EMA structure', weight: 7, value: emaValue },
    { key: 'levels', label: 'Support / resistance', weight: 9, value: clamp(supportValue * blockPenalty, 0, 1) },
    { key: 'momentum', label: 'Momentum', weight: 9, value: momentumValue },
    { key: 'volatility', label: 'Volatility', weight: 6, value: volatilityValue },
    { key: 'entry', label: 'Entry quality', weight: 10, value: entryValue },
    { key: 'riskReward', label: 'Risk / reward', weight: 8, value: riskRewardValue },
    { key: 'setup', label: 'Setup quality', weight: 14, value: candidate.quality },
    { key: 'context1h', label: '1H context', weight: 5, value: clamp((hourlyVote + 1) / 2, 0, 1) },
  ];

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight;

  return { score: Math.round(weighted * 100), components };
}
