'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  HISTORY,
  PRICE_REFRESH_INTERVAL_MS,
  SIGNAL_REFRESH_INTERVAL_MS,
  STATS_REFRESH_INTERVAL_MS,
  type Settings,
} from '@/lib/config';
import type { SignalRecord, SignalStats } from '@/lib/db';
import type { Quote } from '@/lib/quotes';
import type { Signal } from '@/lib/strategy/types';
import type { BacktestState } from './BacktestPanel';

/**
 * Runs the polling loops once for the whole app.
 *
 * Every module reads the same board, so the loops live above the router: moving
 * between pages must not restart the analysis or drop the quote stream, and two
 * modules on screen must never be looking at different reads of the same
 * second. Quotes tick every second, the analysis has new candles once a minute
 * but is priced off the latest quote, and the record only moves when a signal
 * is issued or settled.
 */
export interface MarketData {
  signals: Signal[];
  quotes: Record<string, Quote>;
  history: SignalRecord[];
  stats: SignalStats | null;
  settings: Settings | null;
  error: string | null;
  loading: boolean;
  clearHistory: () => Promise<void>;
  applySettings: (patch: Partial<Settings>) => Promise<void>;
  /**
   * A replay takes a minute or more, so it is owned here rather than by the
   * settings page: walking away to look at the board must not throw it away.
   */
  backtest: BacktestState;
  runBacktest: () => Promise<void>;
  selectBacktestDays: (days: number) => void;
}

const Context = createContext<MarketData | null>(null);

export function useMarketData(): MarketData {
  const value = useContext(Context);
  if (!value) throw new Error('useMarketData used outside MarketDataProvider');
  return value;
}

/**
 * Polls `task` on a trailing timer, so a slow answer never queues another.
 *
 * The next round is scheduled in a `finally`. A task that throws used to end the
 * chain outright, and since nothing schedules it again the board simply stopped
 * updating, with the last prices still on screen looking current. One bad round
 * is not a reason to stop polling.
 */
export function usePoll(task: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        await task();
      } catch {
        // Reported by the task itself if it matters; the loop keeps going.
      } finally {
        if (active) timer = setTimeout(tick, intervalMs);
      }
    };
    timer = setTimeout(tick, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [task, intervalMs]);
}

/**
 * A request that cannot hang.
 *
 * `fetch` waits forever by default, so one stalled request would freeze the
 * loop above for as long as the socket stayed open. Anything past the deadline
 * is abandoned and retried on the next round.
 */
const REQUEST_TIMEOUT_MS = 15_000;

const ask = (url: string, init?: RequestInit) =>
  fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<BacktestState>({
    days: 7,
    loading: false,
    error: null,
    results: null,
  });
  /** Read inside the replay callback, which must not be recreated per render. */
  const backtestDays = useRef(7);

  /**
   * A session that has run out leaves every route answering 401 forever. Going
   * back to the login page is the only thing that helps, so it happens here
   * rather than filling the board with errors.
   */
  const signedOut = useCallback(() => {
    router.replace('/login');
    router.refresh();
  }, [router]);

  const refreshQuotes = useCallback(async () => {
    try {
      const response = await ask('/api/prices');
      if (response.status === 401) return signedOut();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Не удалось загрузить котировки');
      setQuotes(
        Object.fromEntries((body.quotes as Quote[]).map((quote) => [quote.instrumentId, quote])),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить котировки');
    }
  }, [signedOut]);

  const refreshSignals = useCallback(async () => {
    try {
      const [signalsResponse, historyResponse] = await Promise.all([
        ask('/api/signals'),
        ask(`/api/history?limit=${HISTORY.limit}`),
      ]);
      if (signalsResponse.status === 401) return signedOut();
      const body = await signalsResponse.json();
      if (!signalsResponse.ok) throw new Error(body.error ?? 'Не удалось загрузить сигналы');

      setSignals(body.signals);
      if (historyResponse.ok) setHistory((await historyResponse.json()).signals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сигналы');
    }
  }, [signedOut]);

  const refreshStats = useCallback(async () => {
    try {
      const response = await ask('/api/stats');
      if (response.ok) setStats((await response.json()).stats);
    } catch {
      // The record is a read of what is already on screen; a missed poll is
      // not worth putting a banner in front of the board.
    }
  }, []);

  useEffect(() => {
    ask('/api/settings')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body && setSettings(body.settings))
      .catch(() => setSettings(null));
  }, []);

  usePoll(refreshQuotes, PRICE_REFRESH_INTERVAL_MS);
  usePoll(refreshSignals, SIGNAL_REFRESH_INTERVAL_MS);
  usePoll(refreshStats, STATS_REFRESH_INTERVAL_MS);

  const clearHistory = useCallback(async () => {
    try {
      const response = await ask('/api/history', { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Не удалось очистить историю');
      await Promise.all([refreshSignals(), refreshStats()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось очистить историю');
    }
  }, [refreshSignals, refreshStats]);

  const applySettings = useCallback(
    async (patch: Partial<Settings>) => {
      const response = await ask('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Не удалось сохранить настройки');
      setSettings(body.settings);
      await Promise.all([refreshSignals(), refreshStats()]);
    },
    [refreshSignals, refreshStats],
  );

  const selectBacktestDays = useCallback((days: number) => {
    backtestDays.current = days;
    setBacktest((current) => ({ ...current, days }));
  }, []);

  const runBacktest = useCallback(async () => {
    setBacktest((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch(`/api/backtest?days=${backtestDays.current}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Проверка не прошла');
      setBacktest((current) => ({ ...current, loading: false, results: body.results }));
    } catch (cause) {
      setBacktest((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : 'Проверка не прошла',
      }));
    }
  }, []);

  const value = useMemo<MarketData>(
    () => ({
      signals,
      quotes,
      history,
      stats,
      settings,
      error,
      loading: signals.length === 0 && !error,
      clearHistory,
      applySettings,
      backtest,
      runBacktest,
      selectBacktestDays,
    }),
    [
      signals,
      quotes,
      history,
      stats,
      settings,
      error,
      clearHistory,
      applySettings,
      backtest,
      runBacktest,
      selectBacktestDays,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
