'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PRICE_REFRESH_INTERVAL_MS, SIGNAL_REFRESH_INTERVAL_MS } from '@/lib/config';
import type { SignalRecord } from '@/lib/db';
import type { Quote } from '@/lib/quotes';
import type { Signal } from '@/lib/strategy/types';
import { BacktestPanel, type BacktestState } from './BacktestPanel';
import { HistoryTable } from './HistoryTable';
import { SignalCard } from './SignalCard';

/**
 * Runs two independent loops on purpose: quotes tick every second, while the
 * full multi-timeframe analysis only has new candles to read once a minute.
 */
function usePoll(task: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await task();
      if (active) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [task, intervalMs]);
}

function Board({
  title,
  note,
  signals,
  quotes,
  loading,
}: {
  title: string;
  note?: string;
  signals: Signal[];
  quotes: Record<string, Quote>;
  loading: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-[0.15em] text-neutral-300">{title}</h2>
      {note && <p className="mt-1 text-[11px] text-muted">{note}</p>}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {loading &&
          [0, 1].map((index) => (
            <div key={index} className="h-64 animate-pulse rounded-xl border border-edge bg-surface" />
          ))}
        {signals.map((signal) => (
          <SignalCard key={signal.instrumentId} signal={signal} quote={quotes[signal.instrumentId]} />
        ))}
      </div>
      {!loading && signals.length === 0 && (
        <p className="mt-3 rounded-xl border border-edge bg-surface px-4 py-3 text-[13px] text-muted">
          Nothing here right now.
        </p>
      )}
    </section>
  );
}

export function Dashboard() {
  /** Read inside the replay callback, which must not be recreated per render. */
  const backtestDays = useRef(210);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<BacktestState>({
    days: 210,
    loading: false,
    error: null,
    swing: null,
    results: null,
  });

  // A replay takes a minute or more, so it is owned here rather than in the
  // panel, where the price poll's re-renders could interrupt it.
  const runBacktest = useCallback(async () => {
    setBacktest((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch(`/api/backtest?days=${backtestDays.current}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Backtest failed');
      setBacktest((current) => ({ ...current, loading: false, swing: body.swing, results: body.results }));
    } catch (cause) {
      setBacktest((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : 'Backtest failed',
      }));
    }
  }, []);

  const selectDays = useCallback((days: number) => {
    backtestDays.current = days;
    setBacktest((current) => ({ ...current, days }));
  }, []);

  const refreshQuotes = useCallback(async () => {
    try {
      const response = await fetch('/api/prices', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load prices');
      setQuotes(
        Object.fromEntries((body.quotes as Quote[]).map((quote) => [quote.instrumentId, quote])),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load prices');
    }
  }, []);

  const refreshSignals = useCallback(async () => {
    try {
      const [signalsResponse, historyResponse] = await Promise.all([
        fetch('/api/signals', { cache: 'no-store' }),
        fetch('/api/history?limit=20', { cache: 'no-store' }),
      ]);
      const body = await signalsResponse.json();
      if (!signalsResponse.ok) throw new Error(body.error ?? 'Could not load signals');

      setSignals(body.signals);
      if (historyResponse.ok) setHistory((await historyResponse.json()).signals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load signals');
    }
  }, []);

  usePoll(refreshQuotes, PRICE_REFRESH_INTERVAL_MS);
  usePoll(refreshSignals, SIGNAL_REFRESH_INTERVAL_MS);

  // Anything actionable comes first; the rest collapses into a watch list.
  const loading = signals.length === 0 && !error;
  const active = signals.filter((signal) => signal.horizon === 'swing' && signal.type !== 'WAIT');
  const scalps = signals.filter((signal) => signal.horizon === 'scalp');
  const waiting = signals.filter((signal) => signal.horizon === 'swing' && signal.type === 'WAIT');

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <header>
        <h1 className="text-lg font-semibold tracking-[0.3em]">SIRENIX</h1>
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-short/40 bg-short/10 px-4 py-3 text-[13px] text-short">
          {error}
        </p>
      )}

      <Board
        title="INDICES · DAILY REVERSION"
        note="Fades a sharp one-day move. Backtest: 62.8% win rate over 2014 trades, closed after 48h."
        signals={active}
        quotes={quotes}
        loading={loading}
      />
      <Board title="SCALPING" signals={scalps} quotes={quotes} loading={loading} />

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted">
          Watching{waiting.length > 0 ? ` · ${waiting.length}` : ''}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {waiting.map((signal) => (
            <span
              key={signal.instrumentId}
              className="tabular rounded-lg border border-edge bg-surface px-3 py-1.5 text-[12px] text-muted"
            >
              {signal.label}{' '}
              <span className="text-neutral-400">
                {(quotes[signal.instrumentId]?.price ?? signal.price).toFixed(signal.decimals)}
              </span>
            </span>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-[0.15em] text-neutral-300">RECENT SIGNALS</h2>
        <div className="mt-3">
          <HistoryTable signals={history} />
        </div>
      </section>

      <section className="mt-10">
        <BacktestPanel state={backtest} onRun={runBacktest} onSelectDays={selectDays} />
      </section>
    </main>
  );
}
