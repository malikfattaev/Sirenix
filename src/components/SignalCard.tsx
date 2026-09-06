import type { Signal } from '@/lib/strategy/types';
import { price, regimeLabel, time } from './format';

const TONE = {
  LONG: { dot: '🟢', text: 'text-long', ring: 'ring-long/30', bar: 'bg-long' },
  SHORT: { dot: '🔴', text: 'text-short', ring: 'ring-short/30', bar: 'bg-short' },
  WAIT: { dot: '⚪', text: 'text-wait', ring: 'ring-edge', bar: 'bg-wait' },
} as const;

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`tabular text-sm font-medium ${accent ?? ''}`}>{value}</span>
    </div>
  );
}

export function SignalCard({ signal }: { signal: Signal }) {
  const tone = TONE[signal.type];
  const { plan, decimals } = signal;

  return (
    <section className={`rounded-xl border border-edge bg-surface p-5 ring-1 ${tone.ring}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.2em] text-neutral-300">{signal.label}</h2>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">
            {regimeLabel(signal.regime)}
            {signal.strategyLabel ? ` · ${signal.strategyLabel}` : ''}
          </p>
        </div>
        <div className="text-right">
          <div className="tabular text-2xl font-semibold">{price(signal.price, decimals)}</div>
          <div className="tabular text-[11px] text-muted">
            {price(signal.bid, decimals)} / {price(signal.ask, decimals)} · spread{' '}
            {price(signal.spread, decimals)}
          </div>
        </div>
      </header>

      <div className="mt-5 flex items-center gap-3">
        <span className={`flex items-center gap-2 text-3xl font-bold tracking-tight ${tone.text}`}>
          <span className="text-2xl">{tone.dot}</span>
          {signal.type}
        </span>
        {signal.type !== 'WAIT' && (
          <span className="tabular text-lg font-medium text-neutral-400">{signal.score}/100</span>
        )}
      </div>

      {signal.type !== 'WAIT' && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-edge">
          <div className={`h-full ${tone.bar}`} style={{ width: `${signal.score}%` }} />
        </div>
      )}

      {plan ? (
        <div className="mt-4 divide-y divide-edge border-y border-edge">
          <Row
            label="Entry"
            value={`${price(plan.entryLow, decimals)} – ${price(plan.entryHigh, decimals)}`}
          />
          <Row label="Stop Loss" value={price(plan.stopLoss, decimals)} accent="text-short" />
          <Row
            label="Take Profit"
            value={
              plan.takeProfit2 === null
                ? price(plan.takeProfit, decimals)
                : `${price(plan.takeProfit, decimals)} → ${price(plan.takeProfit2, decimals)}`
            }
            accent="text-long"
          />
          <Row label="Risk / Reward" value={`1:${plan.riskReward.toFixed(2)}`} />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm text-neutral-400">
          {signal.blockedBy ?? 'No setup right now'}
        </div>
      )}

      <footer className="mt-4 flex justify-between text-[11px] text-muted">
        <span>VWAP {price(signal.vwap, decimals)}</span>
        <span>Updated {time(signal.updatedAt)}</span>
      </footer>
    </section>
  );
}
