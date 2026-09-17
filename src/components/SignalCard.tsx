'use client';

import { useEffect, useRef, useState } from 'react';
import { HORIZON_LABEL, MEASURED_EDGE } from '@/lib/config';
import type { Quote } from '@/lib/quotes';
import type { Signal } from '@/lib/strategy/types';
import { price, regimeLabel, time } from './format';

const TONE = {
  LONG: { dot: '🟢', word: 'ПОКУПКА', text: 'text-long', ring: 'ring-long/30', bar: 'bg-long' },
  SHORT: { dot: '🔴', word: 'ПРОДАЖА', text: 'text-short', ring: 'ring-short/30', bar: 'bg-short' },
  WAIT: { dot: '⚪', word: 'ЖДЁМ', text: 'text-wait', ring: 'ring-edge', bar: 'bg-wait' },
} as const;

/** How long the price stays tinted after a tick. */
const FLASH_MS = 450;

/** Tints the price green or red for a moment on every change, as a broker would. */
function useTickDirection(value: number): 'up' | 'down' | null {
  const previous = useRef(value);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value === previous.current) return;
    setDirection(value > previous.current ? 'up' : 'down');
    previous.current = value;
    const timer = setTimeout(() => setDirection(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return direction;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`tabular text-sm font-medium ${accent ?? ''}`}>{value}</span>
    </div>
  );
}

/**
 * What the engine is measured to be worth, stated where the trade is offered.
 *
 * One line, not a wall: the number and where it comes from. It stays until a
 * replay on data the engine has not seen comes back positive on both halves of
 * the sample, at which point `MEASURED_EDGE` goes and this goes with it.
 */
function UnprovenNotice() {
  const expectancy = MEASURED_EDGE.expectancyR.toFixed(2);
  return (
    <p className="mt-3 rounded-lg border border-notice/40 bg-notice/10 px-3 py-2 text-[12px] leading-snug text-notice">
      <span className="font-semibold">Сигнал не проверен.</span>{' '}
      На истории движок отдаёт <span className="tabular">{expectancy}R</span> за сигнал —
      {' '}{MEASURED_EDGE.signals} сигналов, {MEASURED_EDGE.markets} рынков, {MEASURED_EDGE.days} дней.
      Преимущества пока нет: это стоимость спреда. Торговать по нему — решение ваше.
    </p>
  );
}

export function SignalCard({ signal, quote }: { signal: Signal; quote?: Quote }) {
  const tone = TONE[signal.type];
  const { plan } = signal;

  // The quote loop is a second old at most; the analysis loop may be fifteen.
  const decimals = quote?.decimals ?? signal.decimals;
  const current = quote?.price ?? signal.price;
  const bid = quote?.bid ?? signal.bid;
  const ask = quote?.ask ?? signal.ask;
  const spread = quote?.spread ?? signal.spread;
  const updatedAt = quote?.updatedAt ?? signal.updatedAt;
  const asleep = quote ? !quote.open : false;
  const stale = quote?.stale ?? false;
  const staleFor = Math.round((quote?.age ?? 0) / 60_000);
  const dim = asleep || stale;

  const tick = useTickDirection(current);
  const tickTone = tick === 'up' ? 'text-long' : tick === 'down' ? 'text-short' : '';

  return (
    <section className={`rounded-xl border border-edge bg-surface p-5 ring-1 ${tone.ring}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.2em] text-neutral-300">
            {signal.label} <span className="text-muted">· {HORIZON_LABEL[signal.horizon]}</span>
          </h2>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">
            {/* A sleeping market has no regime worth reading; say so instead. */}
            {asleep
              ? 'СПИТ'
              : [signal.horizon === 'scalp' ? regimeLabel(signal.regime) : null, signal.strategyLabel]
                  .filter(Boolean)
                  .join(' · ') || 'Momentum'}
          </p>
        </div>
        {/*
          The two prices the platform itself shows, named the way it names them.
          The middle of the spread is what the chart and every level are drawn
          on, but it is a price nobody trades at: showing it large is what makes
          this board look like it disagrees with Capital.com.
        */}
        <div className="text-right">
          <div className={`flex items-baseline justify-end gap-4 ${dim ? 'text-muted' : ''}`}>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">продажа</div>
              <div
                className={`tabular text-xl font-semibold transition-colors duration-150 ${dim ? '' : tickTone}`}
              >
                {price(bid, decimals)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">покупка</div>
              <div
                className={`tabular text-xl font-semibold transition-colors duration-150 ${dim ? '' : tickTone}`}
              >
                {price(ask, decimals)}
              </div>
            </div>
          </div>
          <div className="tabular mt-1 text-[11px] text-muted">
            спред {price(spread, decimals)} · середина {price(current, decimals)}
          </div>
          {asleep ? (
            <div className="text-[11px] text-muted">
              спит{quote?.opensAt ? ` · откроется в ${time(quote.opensAt).slice(0, 5)}` : ''}
            </div>
          ) : (
            stale && <div className="text-[11px] text-short">не обновляется {staleFor} мин</div>
          )}
        </div>
      </header>

      <div className="mt-5 flex items-center gap-3">
        <span className={`flex items-center gap-2 text-3xl font-bold tracking-tight ${tone.text}`}>
          <span className="text-2xl">{tone.dot}</span>
          {tone.word}
        </span>
        {signal.type !== 'WAIT' && (
          <span
            className="tabular text-[12px] text-muted"
            title={
              'Сколько факторов сошлось: направление старших таймфреймов, уровни, VWAP, импульс, ' +
              'волатильность, новости. На истории эта оценка не связана с результатом — ' +
              `корреляция ${MEASURED_EDGE.scoreCorrelation}, то есть сигналы с 85 закрывались не лучше, чем с 65.`
            }
          >
            совпало {signal.score} из 100
          </span>
        )}
      </div>

      {signal.type !== 'WAIT' && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-edge">
          <div className={`h-full ${tone.bar}`} style={{ width: `${signal.score}%` }} />
        </div>
      )}

      {/*
        The card prints an entry, a stop and a target beside a strength out of a
        hundred, and that reads as a recommendation whatever the wording says.
        It has not earned that reading: replayed over six weeks on eleven
        markets this engine returns -0.11R a signal, and it does so at every
        holding period and on every market tried. Saying it here, on the card,
        is the difference between a research tool and a bad tip.
      */}
      {signal.type !== 'WAIT' && <UnprovenNotice />}

      {plan ? (
        <div className="mt-4 divide-y divide-edge border-y border-edge">
          <Row
            label="Вход"
            value={`${price(plan.entryLow, decimals)} / ${price(plan.entryHigh, decimals)}`}
          />
          <Row label="Стоп" value={price(plan.stopLoss, decimals)} accent="text-short" />
          <Row
            label="Цель"
            value={
              plan.takeProfit2 === null
                ? price(plan.takeProfit, decimals)
                : `${price(plan.takeProfit, decimals)} / ${price(plan.takeProfit2, decimals)}`
            }
            accent="text-long"
          />
          <Row label="Риск / прибыль" value={`1:${plan.riskReward.toFixed(2)}`} />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm text-neutral-400">
          {signal.blockedBy ?? 'Сетапа сейчас нет'}
        </div>
      )}

      {signal.note && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-[12px] leading-snug ${
            signal.note.includes('поздно')
              ? 'border-short/40 bg-short/10 text-short'
              : 'border-edge bg-surface-raised text-muted'
          }`}
        >
          {signal.note}
        </p>
      )}

      <footer className="mt-4 flex justify-between text-[11px] text-muted">
        <span>{signal.vwap === null ? signal.epic : `VWAP ${price(signal.vwap, decimals)}`}</span>
        <span>
          {quote?.source === 'stream' ? 'поток' : 'снимок'} · {time(updatedAt)}
        </span>
      </footer>
    </section>
  );
}
