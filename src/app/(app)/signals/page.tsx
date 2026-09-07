'use client';

import { ModuleHeader } from '@/components/AppShell';
import { useMarketData } from '@/components/MarketData';
import { SignalCard } from '@/components/SignalCard';

export default function SignalsPage() {
  const { signals, quotes, loading } = useMarketData();

  return (
    <>
      <ModuleHeader
        title="СИГНАЛЫ"
        hint="Каждый рынок читается на двух горизонтах, поэтому карточек по две на рынок."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {loading &&
          [0, 1, 2, 3].map((index) => (
            <div key={index} className="h-64 animate-pulse rounded-xl border border-edge bg-surface" />
          ))}
        {signals.map((signal) => (
          <SignalCard
            key={`${signal.instrumentId}-${signal.horizon}`}
            signal={signal}
            quote={quotes[signal.instrumentId]}
          />
        ))}
      </div>

      {!loading && signals.length === 0 && (
        <p className="rounded-xl border border-edge bg-surface px-4 py-3 text-[13px] text-muted">
          На доске нет ни одного рынка. Включите их в настройках.
        </p>
      )}
    </>
  );
}
