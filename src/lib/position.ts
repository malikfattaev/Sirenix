import { POSITION, STRATEGY_NAME, type StrategyKey } from '@/lib/config';
import { lastLoss, lossStreak, openSignal, type SignalRecord } from '@/lib/db';
import { lossCooldownMs, maxLossStreak } from '@/lib/settings';
import { STANDING_ASIDE } from '@/lib/strategy';
import type { Signal } from '@/lib/strategy/types';

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** A pause measured in hours reads better than one measured in 240 minutes. */
const hours = (ms: number) => {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  return total < 90 ? `${total} мин` : `${Math.round(total / 60)} ч`;
};

/**
 * Holds the board to the trade it has already published.
 *
 * The engine ranks every setup from scratch on every poll, which is right for
 * finding a trade and wrong for keeping one: a market drifting around a single
 * level will hand the top slot to a fade one minute and to a breakout the next,
 * and following that means closing a losing trade early only to pay the spread
 * again entering the opposite one. The published plan already carries a stop,
 * and the stop is where the read is allowed to be declared wrong.
 *
 * So while a signal is open its market shows that signal and nothing else, and
 * after a losing one the market is left alone for a while before it is offered
 * again.
 */
export function withPosition(signal: Signal): Signal {
  const open = openSignal(signal.instrumentId, signal.horizon);
  if (open) return running(signal, open);

  if (signal.type === 'WAIT') return signal;

  // A run of losses is either the market having changed character or the read
  // being wrong about it. Neither is fixed by taking the next trade straight
  // away, so the market comes off the board until it has had time to change.
  const streak = lossStreak(signal.instrumentId, signal.horizon);
  const streakUntil = streak.lastAt + POSITION.streakPauseMs[signal.horizon];
  if (streak.count >= maxLossStreak() && signal.updatedAt < streakUntil) {
    return standAside(
      signal,
      `${streak.count} убытка подряд, рынок на паузе ещё ${hours(streakUntil - signal.updatedAt)}`,
      `Cut off after ${streak.count} losses in a row rather than sitting through the run`,
    );
  }

  const loss = lastLoss(signal.instrumentId, signal.horizon);
  const until = (loss?.closedAt ?? 0) + lossCooldownMs(signal.horizon);
  if (!loss?.closedAt || signal.updatedAt >= until) return signal;

  return standAside(
    signal,
    `пауза после убытка, ещё ${minutes(until - signal.updatedAt)} мин`,
    'Standing off after a losing trade rather than re-entering into the same move',
  );
}

/** Turns a signal into a refusal that says why. */
function standAside(signal: Signal, cause: string, reason: string): Signal {
  return {
    ...signal,
    type: 'WAIT',
    score: 0,
    strategy: null,
    strategyLabel: null,
    plan: null,
    reasons: [reason],
    blockedBy: `${STANDING_ASIDE} ${cause}`,
  };
}

/**
 * How far along a running signal is, and whether it can still be taken.
 *
 * A scalp is priced for the moment it was issued. Ten minutes later the entry
 * on the card is history: taking it then means a worse fill against the same
 * stop, which is a different trade with worse odds. The card has to say so
 * rather than quietly keep offering a price that has gone.
 */
function progressNote(open: SignalRecord, price: number, now: number): string {
  const s = open.direction === 'LONG' ? 1 : -1;
  const risk = Math.abs(open.entry - open.stopLoss);
  const moved = risk > 0 ? (s * (price - open.entry)) / risk : 0;
  const left = minutes(open.expiresAt - now);

  const gone = moved >= LATE_AFTER_R;
  const against = moved <= -LATE_AFTER_R;
  const state = gone
    ? 'входить поздно, движение уже прошло'
    : against
      ? 'цена ушла против входа, входить поздно'
      : 'вход ещё в силе';

  return `Сигнал идёт ${minutes(now - open.createdAt)} мин, до закрытия ${left} мин. Цена на ${moved >= 0 ? '+' : ''}${moved.toFixed(2)}R от входа: ${state}.`;
}

/**
 * How far price may travel from the entry before the trade is no longer the one
 * that was published. Half the risk: past that the stop is a different distance
 * away than the plan was built on.
 */
const LATE_AFTER_R = 0.5;

/** Re-states an open signal on its original terms, priced off the live quote. */
function running(signal: Signal, open: SignalRecord): Signal {
  return {
    ...signal,
    type: open.direction,
    score: open.score,
    strategy: open.strategy as StrategyKey,
    strategyLabel: STRATEGY_NAME[open.strategy] ?? open.strategy,
    plan: {
      entry: open.entry,
      entryLow: open.entryLow,
      entryHigh: open.entryHigh,
      stopLoss: open.stopLoss,
      takeProfit: open.takeProfit,
      takeProfit2: open.takeProfit2,
      riskReward: open.riskReward,
      stopReason: 'The level that says this read was wrong',
      targetReason: 'The level the move was taken for',
    },
    reasons: [`Already running, ${minutes(open.expiresAt - signal.updatedAt)} min left on it`],
    blockedBy: null,
    note: progressNote(open, signal.price, signal.updatedAt),
  };
}
