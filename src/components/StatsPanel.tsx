'use client';

import type { SignalStats } from '@/lib/db';

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/**
 * Always three numbers, zeros included.
 *
 * An empty record is a state worth seeing, not a reason for the page to fold
 * away: the blocks stay where they are so the screen does not rearrange itself
 * the moment the history is cleared.
 */
export function StatsPanel({ stats }: { stats: SignalStats | null }) {
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-[74px] animate-pulse rounded-xl border border-edge bg-surface" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Всего сигналов" value={stats.total} />
      <Metric label="В плюс" value={stats.profitable} tone="text-long" />
      <Metric label="Сейчас активных" value={stats.open} />
    </div>
  );
}
