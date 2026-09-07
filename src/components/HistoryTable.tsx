import type { SignalRecord } from '@/lib/db';
import { dateTime, price } from './format';

const STATUS_TONE: Record<SignalRecord['status'], string> = {
  OPEN: 'text-neutral-400',
  WIN: 'text-long',
  LOSS: 'text-short',
  EXPIRED: 'text-muted',
  CANCELLED: 'text-muted',
};

/** Shown instead of the raw status where the word alone would mislead. */
const STATUS_LABEL: Partial<Record<SignalRecord['status'], string>> = {
  EXPIRED: 'CLOSED AT TIME',
  CANCELLED: 'NOT EVALUATED',
};

export function HistoryTable({ signals }: { signals: SignalRecord[] }) {
  if (signals.length === 0) {
    return (
      <p className="rounded-xl border border-edge bg-surface p-5 text-sm text-muted">
        No signals recorded yet. They appear here as soon as a setup fires.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-wider text-muted">
          <tr className="border-b border-edge">
            <th className="px-4 py-3 font-medium">Instrument</th>
            <th className="px-4 py-3 font-medium">Signal</th>
            <th className="px-4 py-3 font-medium">Strategy</th>
            <th className="px-4 py-3 text-right font-medium">Entry</th>
            <th className="px-4 py-3 text-right font-medium">SL</th>
            <th className="px-4 py-3 text-right font-medium">TP</th>
            <th className="px-4 py-3 text-right font-medium">Result</th>
            <th className="px-4 py-3 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {signals.map((signal) => (
            <tr key={signal.id}>
              <td className="px-4 py-2.5 text-neutral-300">{signal.label}</td>
              <td
                className={`px-4 py-2.5 font-medium ${signal.direction === 'LONG' ? 'text-long' : 'text-short'}`}
              >
                {signal.direction} <span className="tabular text-muted">{signal.score}</span>
              </td>
              <td className="px-4 py-2.5 text-neutral-400">{signal.strategy}</td>
              <td className="tabular px-4 py-2.5 text-right">{price(signal.entry, signal.decimals)}</td>
              <td className="tabular px-4 py-2.5 text-right">{price(signal.stopLoss, signal.decimals)}</td>
              <td className="tabular px-4 py-2.5 text-right">{price(signal.takeProfit, signal.decimals)}</td>
              <td className={`tabular px-4 py-2.5 text-right ${STATUS_TONE[signal.status]}`}>
                {STATUS_LABEL[signal.status] ?? signal.status}
                {signal.resultR === null ? '' : ` ${signal.resultR > 0 ? '+' : ''}${signal.resultR}R`}
              </td>
              <td className="tabular px-4 py-2.5 text-right text-muted">{dateTime(signal.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
