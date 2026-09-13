'use client';

import { ModuleHeader } from '@/components/AppShell';
import { HistoryTable } from '@/components/HistoryTable';
import { useMarketData } from '@/components/MarketData';
import { StatsPanel } from '@/components/StatsPanel';

export default function DashboardPage() {
  const { stats, history, settings, clearHistory } = useMarketData();

  return (
    <>
      <ModuleHeader title="ПАНЕЛЬ УПРАВЛЕНИЯ" hint="Сколько сигналов было и чем они закончились." />
      <StatsPanel stats={stats} />

      <section className="mt-10">
        <h2 className="mb-3 text-[11px] uppercase tracking-wider text-muted">Последние сигналы</h2>
        <HistoryTable
          signals={history}
          onClear={clearHistory}
          visibleRows={settings?.historyVisibleRows}
        />
      </section>
    </>
  );
}
