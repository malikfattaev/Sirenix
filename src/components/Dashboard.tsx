'use client';

import { useCallback, useEffect, useState } from 'react';
import { PRICE_REFRESH_INTERVAL_MS, SIGNAL_REFRESH_INTERVAL_MS } from '@/lib/config';
import type { SignalRecord } from '@/lib/db';
import type { Quote } from '@/lib/quotes';
import type { Signal } from '@/lib/strategy/types';
import { BacktestPanel } from './BacktestPanel';
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

export function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {signals.length === 0 && !error
          ? [0, 1].map((index) => (
              <div key={index} className="h-64 animate-pulse rounded-xl border border-edge bg-surface" />
            ))
          : signals.map((signal) => (
              <SignalCard
                key={signal.instrumentId}
                signal={signal}
                quote={quotes[signal.instrumentId]}
              />
            ))}
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-[0.15em] text-neutral-300">RECENT SIGNALS</h2>
        <div className="mt-3">
          <HistoryTable signals={history} />
        </div>
      </section>

      <section className="mt-10">
        <BacktestPanel />
      </section>
    </main>
  );
}
