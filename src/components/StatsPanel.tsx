'use client';

import type { SignalStats } from '@/lib/db';

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted">{hint}</div> : null}
    </div>
  );
}

/** Green above water, red below, and neither while there is nothing to judge. */
const tone = (value: number) => (value > 0 ? 'text-long' : value < 0 ? 'text-short' : '');
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

/**
 * Four numbers, zeros included.
 *
 * The result in R leads, because it is the only one that answers the question
 * the page is actually opened to ask. A count of profitable signals is kept
 * beside it rather than instead of it: eight signals split four and four read
 * as an even record right up until the four losses turn out to be full stops
 * and the four gains a tenth of one each.
 *
 * An empty record is a state worth seeing, not a reason for the page to fold
 * away: the blocks stay where they are so the screen does not rearrange itself
 * the moment the history is cleared.
 */
export function StatsPanel({ stats }: { stats: SignalStats | null }) {
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[92px] animate-pulse rounded-xl border border-edge bg-surface" />
        ))}
      </div>
    );
  }

  const settled = stats.wins + stats.losses + stats.expired;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric
        label="Итог, R"
        value={signed(stats.totalR)}
        tone={tone(stats.totalR)}
        hint={settled > 0 ? `по ${settled} закрытым сигналам` : 'закрытых сигналов пока нет'}
      />
      <Metric
        label="На сигнал, R"
        value={signed(stats.expectancy)}
        tone={tone(stats.expectancy)}
        hint="сколько в среднем приносит один сигнал"
      />
      <Metric
        label="Чем закончились"
        value={`${stats.wins} / ${stats.losses} / ${stats.expired}`}
        hint="цель / стоп / по времени"
      />
      <Metric
        label="Всего сигналов"
        value={String(stats.total)}
        hint={`в плюс ${stats.profitable}, активных ${stats.open}`}
      />
    </div>
  );
}
