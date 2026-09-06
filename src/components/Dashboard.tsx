'use client';

import { useCallback, useEffect, useState } from 'react';
import { REFRESH_INTERVAL_MS } from '@/lib/config';
import type { SignalRecord } from '@/lib/db';
import type { Signal } from '@/lib/strategy/types';
import { BacktestPanel } from './BacktestPanel';
import { HistoryTable } from './HistoryTable';
import { SignalCard } from './SignalCard';

export function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [signalsResponse, historyResponse] = await Promise.all([
        fetch('/api/signals', { cache: 'no-store' }),
        fetch('/api/history?limit=20', { cache: 'no-store' }),
      ]);
      const signalsBody = await signalsResponse.json();
      if (!signalsResponse.ok) throw new Error(signalsBody.error ?? 'Could not load signals');

      setSignals(signalsBody.signals);
      setError(null);
      if (historyResponse.ok) setHistory((await historyResponse.json()).signals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load signals');
    }
  }, []);

  // Self-scheduling poll rather than setInterval: a slow round trip delays the
  // next request instead of stacking another one on top of it.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(poll, REFRESH_INTERVAL_MS);
    };
    timer = setTimeout(poll, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);

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
              <div key={index} className="h-80 animate-pulse rounded-xl border border-edge bg-surface" />
            ))
          : signals.map((signal) => <SignalCard key={signal.instrumentId} signal={signal} />)}
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
