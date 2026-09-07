import { HORIZON_LABEL, STRATEGY_NAME, type Horizon } from '@/lib/config';
import type { SignalRecord } from '@/lib/db';
import { dateTime, price } from './format';

const STATUS_TONE: Record<SignalRecord['status'], string> = {
  OPEN: 'text-neutral-400',
  WIN: 'text-long',
  LOSS: 'text-short',
  EXPIRED: 'text-muted',
  CANCELLED: 'text-muted',
};

/**
 * Two horizons run on the same market at once, so the same instrument can
 * appear twice within seconds on completely different terms. Naming the horizon
 * is what tells those rows apart. A signal left by a strategy that has since
 * been removed is marked as such rather than silently looking current.
 */
const horizonOf = (record: SignalRecord): string =>
  HORIZON_LABEL[record.horizon as Horizon] ?? 'СНЯТАЯ СТРАТЕГИЯ';

/** Shown instead of the raw status where the word alone would mislead. */
const STATUS_LABEL: Record<SignalRecord['status'], string> = {
  OPEN: 'ЖДЁМ',
  WIN: 'ПЛЮС',
  LOSS: 'МИНУС',
  EXPIRED: 'ЗАКРЫТ ПО ВРЕМЕНИ',
  CANCELLED: 'НЕ ОЦЕНЁН',
};

export function HistoryTable({ signals }: { signals: SignalRecord[] }) {
  if (signals.length === 0) {
    return (
      <p className="rounded-xl border border-edge bg-surface p-5 text-sm text-muted">
        Сигналов пока не было. Появятся здесь, как только сработает сетап.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-wider text-muted">
          <tr className="border-b border-edge">
            <th className="px-4 py-3 font-medium">Инструмент</th>
            <th className="px-4 py-3 font-medium">Сигнал</th>
            <th className="px-4 py-3 font-medium">Стратегия</th>
            <th className="px-4 py-3 text-right font-medium">Вход</th>
            <th className="px-4 py-3 text-right font-medium">Стоп</th>
            <th className="px-4 py-3 text-right font-medium">Цель</th>
            <th className="px-4 py-3 text-right font-medium">Итог</th>
            <th className="px-4 py-3 text-right font-medium">Время</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {signals.map((signal) => (
            <tr key={signal.id}>
              <td className="px-4 py-2.5 text-neutral-300">
                {signal.label} <span className="text-[11px] text-muted">· {horizonOf(signal)}</span>
              </td>
              <td
                className={`px-4 py-2.5 font-medium ${signal.direction === 'LONG' ? 'text-long' : 'text-short'}`}
              >
                {signal.direction === 'LONG' ? 'ПОКУПКА' : 'ПРОДАЖА'}{' '}
                <span className="tabular text-muted">{signal.score}</span>
              </td>
              <td className="px-4 py-2.5 text-neutral-400">
                {STRATEGY_NAME[signal.strategy] ?? signal.strategy}
              </td>
              <td className="tabular px-4 py-2.5 text-right">{price(signal.entry, signal.decimals)}</td>
              <td className="tabular px-4 py-2.5 text-right">{price(signal.stopLoss, signal.decimals)}</td>
              <td className="tabular px-4 py-2.5 text-right">{price(signal.takeProfit, signal.decimals)}</td>
              <td className={`tabular px-4 py-2.5 text-right ${STATUS_TONE[signal.status]}`}>
                {STATUS_LABEL[signal.status]}
                {signal.resultR === null ? '' : ` ${signal.resultR > 0 ? '+' : ''}${signal.resultR}R`}
              </td>
              <td className="tabular px-4 py-2.5 text-right text-muted">{dateTime(signal.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
