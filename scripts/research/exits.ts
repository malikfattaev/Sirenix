/**
 * Exit-management study: same entries, different ways of managing the position.
 * Both halves of the history are reported, because a management rule can fit
 * one stretch of market just as easily as an entry rule can.
 * Usage: npx tsx --env-file=.env.local scripts/research/exits.ts <days>
 */
import { DEFAULT_TUNING, INSTRUMENTS, type ExitPolicy } from '@/lib/config';
import { loadHistory } from '../lib/data';
import { replay, type BacktestData } from '@/lib/backtest/engine';

const days = Number(process.argv[2] ?? 21);

const POLICIES: { name: string; exit: ExitPolicy }[] = [
  { name: 'stop + target only', exit: { breakEvenAtR: null, trailAtr: null, scaleOut: false } },
  { name: 'break-even at 0.5R', exit: { breakEvenAtR: 0.5, trailAtr: null, scaleOut: false } },
  { name: 'break-even at 1R', exit: { breakEvenAtR: 1, trailAtr: null, scaleOut: false } },
  { name: 'trail 1.5 x 1m ATR', exit: { breakEvenAtR: null, trailAtr: 1.5, scaleOut: false } },
  { name: 'trail 3 x 1m ATR', exit: { breakEvenAtR: null, trailAtr: 3, scaleOut: false } },
  { name: 'trail 5 x 1m ATR', exit: { breakEvenAtR: null, trailAtr: 5, scaleOut: false } },
  { name: 'scale out at TP1', exit: { breakEvenAtR: null, trailAtr: null, scaleOut: true } },
  { name: 'BE 1R + trail 3 ATR', exit: { breakEvenAtR: 1, trailAtr: 3, scaleOut: false } },
  { name: 'scale out + trail 3', exit: { breakEvenAtR: null, trailAtr: 3, scaleOut: true } },
];

async function main() {
  const data = new Map<string, BacktestData>();
  for (const instrument of INSTRUMENTS) data.set(instrument.id, await loadHistory(instrument, days));

  console.log(`${'exit policy'.padEnd(21)} ${'inst'.padEnd(6)} first half              second half             combined`);
  for (const policy of POLICIES) {
    let combined = 0;
    const lines: string[] = [];
    for (const instrument of INSTRUMENTS) {
      const tuning = { ...DEFAULT_TUNING, exit: policy.exit };
      const halves = ([[0, 0.5], [0.5, 1]] as [number, number][]).map((sample) =>
        replay(instrument, data.get(instrument.id)!, { days, tuning, sample }),
      );
      combined += halves[0].totalR + halves[1].totalR;
      lines.push(
        `${policy.name.padEnd(21)} ${instrument.id.padEnd(6)} ` +
          halves
            .map((r) => `n=${String(r.signals).padStart(3)} win=${String(r.winRate).padStart(5)}% ${r.totalR.toFixed(1).padStart(6)}R`)
            .join('   '),
      );
    }
    console.log(lines.join('\n') + `\n${''.padEnd(28)}total ${combined.toFixed(1)}R\n`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
