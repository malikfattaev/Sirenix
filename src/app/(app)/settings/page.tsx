'use client';

import { ModuleHeader } from '@/components/AppShell';
import { BacktestPanel } from '@/components/BacktestPanel';
import { useMarketData } from '@/components/MarketData';
import { SettingsPanel } from '@/components/SettingsPanel';

export default function SettingsPage() {
  const { backtest, runBacktest, selectBacktestDays } = useMarketData();

  return (
    <>
      <ModuleHeader title="НАСТРОЙКИ" hint="Что стоит на доске и как строго отбираются сигналы." />
      <SettingsPanel />

      <section className="mt-10">
        <BacktestPanel state={backtest} onRun={runBacktest} onSelectDays={selectBacktestDays} />
      </section>
    </>
  );
}
