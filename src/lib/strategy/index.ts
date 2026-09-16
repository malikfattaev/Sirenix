import {
  DEFAULT_STRATEGY_PRIORITY,
  DEFAULT_TUNING,
  STRATEGY_PRIORITY,
  type StrategyKey,
  type StrategyTuning,
} from '@/lib/config';
import { buildPlan } from './plan';
import { scoreSetup } from './score';
import { STRATEGIES } from './strategies';
import { sign } from './strategies/shared';
import type { MarketContext, ScoreComponent, SignalType, StrategyCandidate, TradePlan, SignalRejection } from './types';

export * from './types';
export { buildContext } from './context';
export { buildViews } from './views';
export { STRATEGIES, STRATEGY_LABELS } from './strategies';

/** Prefix shared by every reason the board gives for not trading. */
export const STANDING_ASIDE = 'Ждём:';

/** What the broker reports when a market is not tradeable right now. */
const MARKET_STATUS: Record<string, string> = {
  CLOSED: 'закрыт',
  EDITS_ONLY: 'принимает только изменения заявок',
  OFFLINE: 'недоступен',
  SUSPENDED: 'торги приостановлены',
  AUCTION: 'на аукционе',
  AUCTION_NO_EDIT: 'на аукционе',
};

export interface Decision {
  rejections?: SignalRejection[];
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
  // Every reason for standing aside reads the same way, so the card always
  // answers the same question: not "what state is this", but "why not yet".
  const empty = (cause: string, reasons: string[] = [], rejections: SignalRejection[] = []): Decision => ({
    type: 'WAIT',
    score: 0,
    strategy: null,
    strategyLabel: null,
    plan: null,
    reasons,
    blockedBy: `${STANDING_ASIDE} ${cause}`,
    components: [],
    rejections,
  });

  if (context.marketStatus !== 'TRADEABLE') {
    return empty(`рынок ${MARKET_STATUS[context.marketStatus] ?? 'закрыт'}`, [],
      [{ code: 'market_closed', detail: context.marketStatus }]);
  }
  // Outside the hours where a move is large beside the spread there is nothing
  // to trade for: the toll is the same and the distance is a third of it.
  const hours = tuning.tradingHours;
  if (hours) {
    const hour = new Date(context.now).getUTCHours();
    const open = hours.from <= hours.to
      ? hour >= hours.from && hour <= hours.to
      : hour >= hours.from || hour <= hours.to;
    if (!open) {
      return empty(
        `вне торговых часов, спред сейчас съедает движение (${hours.from}:00–${hours.to}:59 UTC)`,
        [],
        [{ code: 'hours', detail: `${hour} outside ${hours.from}-${hours.to} UTC` }],
      );
    }
  }
  if (context.regime === 'CHOP') {
    return empty('рынок пилит, сетапы не работают', [context.regimeReason],
      [{ code: 'chop', detail: context.regimeReason }]);
  }

  const eligible = STRATEGIES.filter(
    (strategy) =>
      strategy.regimes.includes(context.regime) &&
      (tuning.enabledStrategies === null || tuning.enabledStrategies.includes(strategy.key)),
  );
  /** Why each strategy that looked at the market decided against a trade. */
  const rejections: { label: string; cause: string }[] = [];
  const diagnostics: SignalRejection[] = [];
  const evaluated: Evaluated[] = [];

  for (const strategy of eligible) {
    const candidate = strategy.evaluate(context);
    if (!candidate) continue;

    // Refuse to chase: once price has run past the trigger the entry is gone.
    const chased = Math.abs(context.price - candidate.triggerPrice) / context.views.entry.atr;
    if (chased > tuning.maxChaseAtr) {
      diagnostics.push({ code: 'chase', detail: `${chased.toFixed(2)} ATR > ${tuning.maxChaseAtr}`, strategy: strategy.key, direction: candidate.direction });
      rejections.push({ label: strategy.label, cause: `движение уже прошло, ${chased.toFixed(1)} ATR мимо входа` });
      continue;
    }
    // A 1H move straight against us vetoes a continuation setup. A fade is
    // meant to trade against the move, so the veto does not apply to it.
    const hourly = context.views.context;
    const against = sign(candidate.direction) * (hourly.close - hourly.ema20);
    if (strategy.bias === 'continuation' && against < -1.5 * hourly.atr) {
      diagnostics.push({ code: 'hourly_veto', detail: 'Hourly move opposes continuation', strategy: strategy.key, direction: candidate.direction });
      rejections.push({ label: strategy.label, cause: 'часовой график идёт сильно против' });
      continue;
    }

    const plan = buildPlan(context, candidate, tuning);
    if (!plan.ok) {
      diagnostics.push({ code: plan.code, detail: plan.detail, strategy: strategy.key, direction: candidate.direction });
      rejections.push({ label: strategy.label, cause: plan.detail });
      continue;
    }

    const { score, components } = scoreSetup(context, candidate, strategy.bias, plan.plan, tuning);
    if (score < tuning.minScore) {
      diagnostics.push({ code: 'score', detail: `${score} < ${tuning.minScore}`, strategy: strategy.key, direction: candidate.direction, score, plan: plan.plan });
      rejections.push({ label: strategy.label, cause: `совпадений только ${score} из ${tuning.minScore} нужных` });
      continue;
    }
    evaluated.push({ candidate, label: strategy.label, plan: plan.plan, score, components });
  }

  if (evaluated.length === 0) {
    // The nearest miss is far more useful than "nothing fired".
    const nearest = rejections[0];
    return empty(nearest ? nearest.cause : 'ни один сетап пока не сложился', [
      context.regimeReason,
      ...rejections.slice(0, 3).map((rejection) => `${rejection.label}: ${rejection.cause}`),
    ], diagnostics.length ? diagnostics : [{ code: 'no_setup', detail: 'No eligible setup' }]);
  }

  const priority = STRATEGY_PRIORITY[context.instrumentId] ?? DEFAULT_STRATEGY_PRIORITY;
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
