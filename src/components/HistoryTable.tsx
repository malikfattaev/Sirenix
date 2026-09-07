'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ALL_INSTRUMENTS, HISTORY, HORIZON_LABEL, STRATEGY_NAME, type Horizon } from '@/lib/config';
import type { SignalRecord } from '@/lib/db';
import { dateTime, price } from './format';

const STATUS_TONE: Record<SignalRecord['status'], string> = {
  OPEN: 'text-neutral-400',
  WIN: 'text-long',
  LOSS: 'text-short',
  EXPIRED: 'text-muted',
  REVERSED: 'text-muted',
  CANCELLED: 'text-muted',
};

/**
 * Two horizons run on the same market at once, so the same instrument can
 * appear twice within seconds on completely different terms. Naming the horizon
 * is what tells those rows apart.
 */
const horizonOf = (record: SignalRecord): string => HORIZON_LABEL[record.horizon as Horizon];

/** Shown instead of the raw status where the word alone would mislead. */
const STATUS_LABEL: Record<SignalRecord['status'], string> = {
  OPEN: 'ЖДЁМ',
  WIN: 'ПЛЮС',
  LOSS: 'МИНУС',
  EXPIRED: 'ЗАКРЫТ ПО ВРЕМЕНИ',
  REVERSED: 'ЗАКРЫТ ПО РАЗВОРОТУ',
  CANCELLED: 'НЕ ОЦЕНЁН',
};

type DirectionFilter = 'ALL' | 'LONG' | 'SHORT';

const DIRECTIONS: { key: DirectionFilter; label: string; tone: string }[] = [
  { key: 'ALL', label: 'Все', tone: 'text-neutral-100' },
  { key: 'LONG', label: 'Покупка', tone: 'text-long' },
  { key: 'SHORT', label: 'Продажа', tone: 'text-short' },
];

/**
 * Keeps the list to `HISTORY.visibleRows` and scrolls the rest.
 *
 * The height is measured rather than assumed: a row wraps to two lines as soon
 * as a strategy name is long or the window is narrow, so a fixed height would
 * cut the fifth row in half on exactly the rows worth reading. Measuring where
 * the *next* row starts gives the header plus five whole rows, whatever they
 * came out to.
 */
function useVisibleRows(rowCount: number, visibleRows: number) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const container = scroller.current;
    const rows = body.current;
    if (!container || !rows) return;

    const measure = () => {
      const cut = rows.rows[visibleRows];
      if (!cut) {
        setMaxHeight(undefined);
        return;
      }
      const top = container.getBoundingClientRect().top;
      setMaxHeight(cut.getBoundingClientRect().top - top + container.scrollTop);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rows);
    return () => observer.disconnect();
  }, [rowCount, visibleRows]);

  return { scroller, body, maxHeight };
}

function Chip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12px] transition ${
        active
          ? `border-neutral-600 bg-surface-raised ${tone ?? 'text-neutral-100'}`
          : 'border-edge text-muted hover:border-neutral-700 hover:text-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}

export function HistoryTable({
  signals,
  onClear,
  visibleRows = HISTORY.visibleRows,
}: {
  signals: SignalRecord[];
  onClear: () => Promise<void>;
  /** Overridden from the settings module; falls back to the compiled default. */
  visibleRows?: number;
}) {
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [markets, setMarkets] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Only markets that actually appear, in the order the board lists them, so
  // the filter never offers a chip that can select nothing.
  const available = useMemo(() => {
    const present = new Set(signals.map((signal) => signal.instrumentId));
    return ALL_INSTRUMENTS.filter((instrument) => present.has(instrument.id));
  }, [signals]);

  const picked = useMemo(
    () => markets.filter((id) => available.some((instrument) => instrument.id === id)),
    [markets, available],
  );

  const visible = useMemo(
    () =>
      signals.filter(
        (signal) =>
          (direction === 'ALL' || signal.direction === direction) &&
          (picked.length === 0 || picked.includes(signal.instrumentId)),
      ),
    [signals, direction, picked],
  );

  const { scroller, body, maxHeight } = useVisibleRows(visible.length, visibleRows);

  const toggleMarket = (id: string) =>
    setMarkets((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );

  const clear = async () => {
    setClearing(true);
    try {
      await onClear();
      setConfirming(false);
    } finally {
      setClearing(false);
    }
  };

  const controls = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex overflow-hidden rounded-lg border border-edge">
        {DIRECTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setDirection(option.key)}
            className={`px-3 py-1.5 text-[12px] transition ${
              direction === option.key
                ? `bg-surface-raised ${option.tone}`
                : 'text-muted hover:text-neutral-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {available.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={picked.length === 0} onClick={() => setMarkets([])}>
            Все рынки
          </Chip>
          {available.map((instrument) => (
            <Chip
              key={instrument.id}
              active={picked.includes(instrument.id)}
              onClick={() => toggleMarket(instrument.id)}
            >
              {instrument.label}
            </Chip>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[12px] text-muted">Удалить завершённые? Активные останутся.</span>
            <button
              type="button"
              onClick={clear}
              disabled={clearing}
              className="rounded-lg border border-short/50 bg-short/10 px-3 py-1.5 text-[12px] font-medium text-short transition hover:border-short disabled:opacity-50"
            >
              {clearing ? 'Чищу…' : 'Да'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-edge px-3 py-1.5 text-[12px] text-muted transition hover:text-neutral-300"
            >
              Отмена
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-edge bg-surface-raised px-3 py-1.5 text-[12px] text-muted transition hover:border-neutral-600 hover:text-neutral-200"
          >
            Очистить историю
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {controls}

      <div className="overflow-hidden rounded-xl border border-edge bg-surface">
        <div ref={scroller} className="overflow-auto" style={{ maxHeight }}>
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface text-[11px] uppercase tracking-wider text-muted">
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
            <tbody ref={body} className="divide-y divide-edge">
              {visible.map((signal) => (
                <tr key={signal.id}>
                  <td className="px-4 py-2.5 text-neutral-300">
                    {signal.label} <span className="text-[11px] text-muted">· {horizonOf(signal)}</span>
                  </td>
                  <td
                    className={`px-4 py-2.5 font-medium ${signal.direction === 'LONG' ? 'text-long' : 'text-short'}`}
                  >
                    {signal.direction === 'LONG' ? 'ПОКУПКА' : 'ПРОДАЖА'}{' '}
                    <span className="tabular text-muted" title="Совпадение факторов, не вероятность прибыли">
                      совп. {signal.score}
                    </span>
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

        {visible.length === 0 && (
          <p className="border-t border-edge px-4 py-3 text-[12px] text-muted">
            {signals.length === 0
              ? 'Сигналов пока не было. Появятся здесь, как только сработает сетап.'
              : 'Под фильтр ничего не попало.'}
          </p>
        )}
        {visible.length > visibleRows && (
          <p className="border-t border-edge px-4 py-2 text-[11px] text-muted">
            Показаны {visibleRows} из {visible.length}, остальное прокруткой.
          </p>
        )}
      </div>
    </div>
  );
}
