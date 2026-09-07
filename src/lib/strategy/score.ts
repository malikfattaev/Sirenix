import type {
  ScoreComponent,
  MarketContext,
  StrategyBias,
  StrategyCandidate,
  TradePlan,
} from './types';
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
  bias: StrategyBias,
  plan: TradePlan | null,
  tuning: StrategyTuning = DEFAULT_TUNING,
): { score: number; components: ScoreComponent[] } {
  const { direction: higher, setup, entry, context: hourly } = context.views;
  const s = sign(candidate.direction);

  /**
   * A continuation setup is graded on how much a timeframe agrees with it; a
   * reversion setup on how much there is to trade against. Both land in 0-1.
   */
  const grade = (vote: number) =>
    bias === 'continuation' ? clamp((s * vote + 1) / 2, 0, 1) : clamp(Math.abs(vote), 0, 1);

  const directionVote = grade(trendVote(higher));
  const setupVote = grade(trendVote(setup));
  const hourlyVote = grade(trendVote(hourly));

  const wanted = candidate.direction === 'LONG' ? 'up' : 'down';
  const aligned = setup.structure === wanted ? 1 : setup.structure === 'range' ? 0.5 : 0.1;
  const structureValue = bias === 'continuation' ? aligned : 1 - aligned + 0.1;

  // Continuation wants price on its own side of VWAP; a fade wants it stretched
  // away from VWAP, which is exactly what it expects to be given back.
  const vwapDistance = context.vwap === null ? null : (s * (context.price - context.vwap)) / setup.atr;
  const vwapValue =
    vwapDistance === null
      ? 0.5
      : bias === 'continuation'
        ? plateau(vwapDistance, -1.6, -0.2, 1.6, 3.5)
        : plateau(-vwapDistance, 0.1, 0.8, 3.0, 5.0);

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

  // Continuation wants momentum behind it; a fade wants the other side exhausted.
  const relativeRsi = candidate.direction === 'LONG' ? setup.rsi : 100 - setup.rsi;
  const momentumValue =
    bias === 'continuation'
      ? plateau(relativeRsi, 25, 45, 72, 88)
      : plateau(relativeRsi, 5, 15, 45, 62);

  const volatilityValue =
    plateau(entry.atrRatio, 0.45, 0.8, 1.6, 2.4) * plateau(setup.atrPercent, 0.005, 0.02, 0.6, 1.6);

  // Entry quality: how much of the move is already gone.
  const chased = Math.abs(context.price - candidate.triggerPrice) / entry.atr;
  const entryValue = plateau(chased, -0.1, 0, tuning.maxChaseAtr * 0.5, tuning.maxChaseAtr);

  const riskRewardValue = plan
    ? clamp((plan.riskReward - tuning.minRiskReward) / (3 - tuning.minRiskReward), 0, 1)
    : 0.4;

  // Headlines are a tiebreaker, never a reason on their own: with no coverage
  // the component sits at neutral, and it can only move the total by its weight.
  const pulse = context.news;
  const newsValue =
    !pulse || pulse.confidence <= 0
      ? 0.5
      : clamp(0.5 + 0.5 * s * pulse.sentiment * pulse.confidence * (pulse.burst ? 1 : 0.7), 0, 1);

  const components: ScoreComponent[] = [
    { key: 'direction15m', label: '15m direction', weight: 12, value: directionVote },
    { key: 'trend5m', label: '5m trend', weight: 12, value: setupVote },
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
    { key: 'context1h', label: '1H context', weight: 5, value: hourlyVote },
    { key: 'news', label: 'Headlines', weight: 6, value: newsValue },
  ];

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight;

  return { score: Math.round(weighted * 100), components };
}
