import {
  DEFAULT_TUNING,
  STRATEGY_PRIORITY,
  type StrategyKey,
  type StrategyTuning,
} from '@/lib/config';
import { buildPlan } from './plan';
import { scoreSetup } from './score';
import { STRATEGIES } from './strategies';
import { sign } from './strategies/shared';
import type { MarketContext, ScoreComponent, SignalType, StrategyCandidate, TradePlan } from './types';

export * from './types';
export { buildContext } from './context';
export { buildViews } from './views';
export { STRATEGIES, STRATEGY_LABELS } from './strategies';

export interface Decision {
  type: SignalType;
  score: number;
  strategy: StrategyKey | null;
  strategyLabel: string | null;
  plan: TradePlan | null;
  reasons: string[];
  blockedBy: string | null;
  components: ScoreComponent[];
}

/** A fully evaluated setup, before the final pick. */
interface Evaluated {
  candidate: StrategyCandidate;
  label: string;
  plan: TradePlan;
  score: number;
  components: ScoreComponent[];
}

/**
 * Chooses what to do right now.
 *
 * Order of operations mirrors how the setups are meant to be read: establish
 * the regime, let only the strategies that suit it propose a trade, price each
 * proposal, and take the strongest one — or stand aside. Every gate here can
 * only downgrade a signal to WAIT, never promote one.
 */
export function decide(
  context: MarketContext,
  tuning: StrategyTuning = DEFAULT_TUNING,
): Decision {
  const empty = (blockedBy: string, reasons: string[] = []): Decision => ({
    type: 'WAIT',
    score: 0,
    strategy: null,
    strategyLabel: null,
    plan: null,
    reasons,
    blockedBy,
    components: [],
  });

  if (context.marketStatus !== 'TRADEABLE') {
    return empty(`Market is ${context.marketStatus.toLowerCase().replace(/_/g, ' ')}`);
  }
  if (context.regime === 'CHOP') {
    return empty('Choppy market — standing aside', [context.regimeReason]);
  }

  const eligible = STRATEGIES.filter((strategy) => strategy.regimes.includes(context.regime));
  const rejections: string[] = [];
  const evaluated: Evaluated[] = [];

  for (const strategy of eligible) {
    const candidate = strategy.evaluate(context);
    if (!candidate) continue;

    // Refuse to chase: once price has run past the trigger the entry is gone.
    const chased = Math.abs(context.price - candidate.triggerPrice) / context.views.entry.atr;
    if (chased > tuning.maxChaseAtr) {
      rejections.push(`${strategy.label}: move already happened (${chased.toFixed(1)} ATR past entry)`);
      continue;
    }
    // A 1H move straight against us is the one veto the hourly frame gets.
    const hourly = context.views.context;
    const against = sign(candidate.direction) * (hourly.close - hourly.ema20);
    if (against < -1.5 * hourly.atr) {
      rejections.push(`${strategy.label}: 1H is moving hard the other way`);
      continue;
    }

    const plan = buildPlan(context, candidate, tuning);
    if (!plan.ok) {
      rejections.push(`${strategy.label}: ${plan.detail}`);
      continue;
    }

    const { score, components } = scoreSetup(context, candidate, plan.plan, tuning);
    if (score < tuning.minScore) {
      rejections.push(`${strategy.label}: confluence ${score}/100`);
      continue;
    }
    evaluated.push({ candidate, label: strategy.label, plan: plan.plan, score, components });
  }

  if (evaluated.length === 0) {
    return empty('No setup meets the requirements right now', [
      context.regimeReason,
      ...rejections.slice(0, 3),
    ]);
  }

  const priority = STRATEGY_PRIORITY[context.instrumentId] ?? [];
  const best = evaluated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return priority.indexOf(a.candidate.strategy) - priority.indexOf(b.candidate.strategy);
  })[0];

  return {
    type: best.candidate.direction,
    score: best.score,
    strategy: best.candidate.strategy,
    strategyLabel: best.label,
    plan: best.plan,
    reasons: [
      context.regimeReason,
      ...best.candidate.reasons,
      best.plan.stopReason,
      best.plan.targetReason,
    ],
    blockedBy: null,
    components: best.components,
  };
}
