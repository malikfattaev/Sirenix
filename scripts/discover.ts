/**
 * Builds the research universe.
 *
 * A weak edge is only measurable across many markets, so this collects the
 * liquid, continuously quoted instruments Capital.com offers and ranks them by
 * relative spread, which is the cost every strategy has to clear.
 * Usage: npx tsx --env-file=.env.local scripts/discover.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { capital } from '@/lib/capital/client';


/** Search terms broad enough to surface the whole liquid universe. */
const TERMS = [
  'gold', 'silver', 'platinum', 'palladium', 'copper', 'aluminium', 'zinc', 'nickel',
  'oil', 'gas', 'gasoline', 'heating', 'wheat', 'corn', 'soybean', 'sugar', 'coffee', 'cocoa', 'cotton',
  'us 500', 'us tech', 'us 30', 'russell', 'germany', 'france', 'uk 100', 'europe', 'japan',
  'australia', 'hong kong', 'china', 'india', 'spain', 'italy', 'netherlands', 'switzerland',
  'eur', 'usd', 'gbp', 'jpy', 'aud', 'cad', 'chf', 'nzd', 'sek', 'nok',
  'bitcoin', 'ethereum', 'solana', 'ripple', 'cardano', 'litecoin', 'dogecoin', 'polkadot',
];

const WANTED_TYPES = new Set(['COMMODITIES', 'INDICES', 'CURRENCIES', 'CRYPTOCURRENCIES']);
/** Dated futures roll and have thin, discontinuous history. */
const DATED = /(19|20)\d{2}$/;

interface Candidate {
  epic: string;
  name: string;
  type: string;
  bid: number;
  offer: number;
  /** Spread as a fraction of price — the cost floor for any strategy. */
  spreadBps: number;
}

async function main() {
  const found = new Map<string, Candidate>();

  for (const term of TERMS) {
    try {
      for (const market of await capital.searchMarkets(term)) {
        const { epic, instrumentName, instrumentType, marketStatus, bid, offer } = market;
        if (!WANTED_TYPES.has(instrumentType) || marketStatus !== 'TRADEABLE') continue;
        if (DATED.test(epic) || bid === null || offer === null || bid <= 0) continue;
        if (found.has(epic)) continue;
        found.set(epic, {
          epic,
          name: instrumentName,
          type: instrumentType,
          bid,
          offer,
          spreadBps: ((offer - bid) / ((offer + bid) / 2)) * 10_000,
        });
      }
    } catch {
      // A single failed search term should not stop the scan.
    }
  }

  const ranked = [...found.values()].sort((a, b) => a.spreadBps - b.spreadBps);
  const byType = new Map<string, Candidate[]>();
  for (const candidate of ranked) {
    byType.set(candidate.type, [...(byType.get(candidate.type) ?? []), candidate]);
  }

  console.log(`${found.size} tradeable instruments found\n`);
  for (const [type, list] of byType) {
    console.log(`--- ${type} (${list.length}) ---`);
    for (const candidate of list.slice(0, 25)) {
      console.log(
        `  ${candidate.epic.padEnd(14)} ${candidate.spreadBps.toFixed(1).padStart(7)} bps  ${candidate.name}`,
      );
    }
    console.log('');
  }

  const outFile = path.join(process.cwd(), 'data', 'universe.json');
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(ranked, null, 2));
  console.log(`written to ${outFile}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
