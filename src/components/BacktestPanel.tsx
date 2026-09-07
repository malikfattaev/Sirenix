'use client';

import type { BacktestResult } from '@/lib/backtest/engine';
import type { SwingBacktestResult } from '@/lib/backtest/swing';

/** The API strips the trade list, so the panel only ever sees the summary. */
export type Summary = Omit<BacktestResult, 'trades'>;

export interface BacktestState {
  days: number;
  loading: boolean;
  error: string | null;
  swing: SwingBacktestResult | null;
  results: Summary[] | null;
}

const DAY_OPTIONS = [30, 90, 210];

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`tabular mt-0.5 text-lg font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/**
 * Presentational only: a replay can take a minute or two, so the state lives in
 * the dashboard rather than here, where a re-render could discard it.
 */
export function BacktestPanel({
  state,
  onRun,
  onSelectDays,
}: {
  state: BacktestState;
  onRun: () => void;
  onSelectDays: (days: number) => void;
}) {
  const { days, loading, error, swing, results } = state;

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-[0.15em] text-neutral-300">STRATEGY CHECK</h3>
          <p className="mt-1 text-[12px] text-muted">
            Replays the exact same logic over historical candles, without ever looking at a future one.
            The window is split in half: a strategy has to work in both.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-edge">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onSelectDays(option)}
                className={`px-3 py-1.5 text-[12px] transition ${
                  days === option ? 'bg-surface-raised text-neutral-100' : 'text-muted hover:text-neutral-300'
                }`}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onRun}
            disabled={loading}
            className="rounded-lg border border-edge bg-surface-raised px-4 py-1.5 text-[12px] font-medium text-neutral-200 transition hover:border-neutral-600 disabled:opacity-50"
          >
            {loading ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-[13px] text-short">{error}</p>}

      {swing && (
        <div className="mt-5 rounded-lg border border-edge bg-surface-raised p-4">
          <div className="flex items-baseline justify-between">
            <h4 className="text-[13px] font-semibold tracking-wider text-neutral-300">
              DAILY REVERSION
            </h4>
            <span className="text-[11px] text-muted">
              {swing.byInstrument.filter((row) => row.totalR > 0).length} of {swing.byInstrument.length} markets positive
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Signals" value={String(swing.signals)} />
            <Metric label="Win rate" value={`${swing.winRate}%`} tone={swing.winRate >= 55 ? 'text-long' : ''} />
            <Metric label="Per trade" value={`${swing.expectancy > 0 ? '+' : ''}${swing.expectancy}R`} tone={swing.expectancy > 0 ? 'text-long' : 'text-short'} />
            <Metric label="Profit factor" value={swing.profitFactor?.toFixed(2) ?? '-'} />
            <Metric label="1st half" value={`${swing.firstHalfR > 0 ? '+' : ''}${swing.firstHalfR}R`} tone={swing.firstHalfR > 0 ? 'text-long' : 'text-short'} />
            <Metric label="2nd half" value={`${swing.secondHalfR > 0 ? '+' : ''}${swing.secondHalfR}R`} tone={swing.secondHalfR > 0 ? 'text-long' : 'text-short'} />
          </div>

          <table className="mt-4 w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted">
              <tr className="border-b border-edge">
                <th className="py-2 font-medium">Market</th>
                <th className="py-2 text-right font-medium">n</th>
                <th className="py-2 text-right font-medium">Win rate</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {swing.byInstrument.map((row) => (
                <tr key={row.instrumentId}>
                  <td className="py-2 text-neutral-300">{row.label}</td>
                  <td className="tabular py-2 text-right text-neutral-400">{row.signals}</td>
                  <td className="tabular py-2 text-right text-neutral-400">{row.winRate}%</td>
                  <td className={`tabular py-2 text-right ${row.totalR > 0 ? 'text-long' : 'text-short'}`}>
                    {row.totalR > 0 ? '+' : ''}
                    {row.totalR}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && (
        <div className="mt-5 space-y-5">
          {results.map((result) => (
            <div key={result.instrumentId} className="rounded-lg border border-edge bg-surface-raised p-4">
              <div className="flex items-baseline justify-between">
                <h4 className="text-[13px] font-semibold tracking-wider text-neutral-300">
                  {result.label} <span className="font-normal text-muted">· scalping</span>
                </h4>
                <span className="text-[11px] text-muted">{result.barsTested} bars replayed</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Signals" value={String(result.signals)} />
                <Metric label="Wins" value={String(result.wins)} tone="text-long" />
                <Metric label="Losses" value={String(result.losses)} tone="text-short" />
                <Metric label="Win rate" value={`${result.winRate}%`} />
                <Metric label="Avg R/R" value={`1:${result.avgRiskReward}`} />
                <Metric
                  label="Total"
                  value={`${result.totalR > 0 ? '+' : ''}${result.totalR}R`}
                  tone={result.totalR > 0 ? 'text-long' : 'text-short'}
                />
              </div>

              {result.byStrategy.length > 0 && (
                <table className="mt-4 w-full text-left text-[12px]">
                  <thead className="text-[10px] uppercase tracking-wider text-muted">
                    <tr className="border-b border-edge">
                      <th className="py-2 font-medium">Strategy</th>
                      <th className="py-2 text-right font-medium">n</th>
                      <th className="py-2 text-right font-medium">Win rate</th>
                      <th className="py-2 text-right font-medium">Avg R/R</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {result.byStrategy.map((row) => (
                      <tr key={row.strategy}>
                        <td className="py-2 text-neutral-300">{row.strategy}</td>
                        <td className="tabular py-2 text-right text-neutral-400">{row.signals}</td>
                        <td className="tabular py-2 text-right text-neutral-400">{row.winRate}%</td>
                        <td className="tabular py-2 text-right text-neutral-400">1:{row.avgRiskReward}</td>
                        <td
                          className={`tabular py-2 text-right ${row.totalR > 0 ? 'text-long' : 'text-short'}`}
                        >
                          {row.totalR > 0 ? '+' : ''}
                          {row.totalR}R
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
