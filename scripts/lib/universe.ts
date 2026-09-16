/** Shared definitions for the research scripts: the traded universe and the feature list. */
import type { InstrumentConfig } from '@/lib/config';

/** Candidate predictors, in the order they appear in a pooled row's feature vector. */
export const FEATURE_NAMES = [
  'ema9-20 5m',
  'ema20-50 5m',
  'ema9-20 15m',
  'ema9-20 1H',
  'extension 5m',
  'extension 15m',
  'rsi 5m',
  'rsi 15m',
  'rsi 1H',
  'return 5m',
  'return 15m',
  'return 30m',
  'return 60m',
  'return 4H',
  'atr ratio',
  'range position',
  'volume ratio',
  'body 5m',
  'wick balance',
  'reversal 60m',
] as const;

/** Forward horizons in 5-minute bars. */
export const HORIZON_BARS = [1, 3, 6, 12];

/** The instruments the research runs across, chosen for tight spreads and continuous quoting. */
export interface UniverseEntry {
  epic: string;
  type: 'INDICES' | 'CURRENCIES' | 'COMMODITIES' | 'CRYPTOCURRENCIES';
}

export const UNIVERSE: UniverseEntry[] = [
  ...([
    'US30', 'US500', 'US100', 'DE40', 'UK100', 'FR40', 'NL25', 'J225', 'RTY',
    'HK50', 'SW20', 'SP35', 'AU200', 'HSTECH', 'HSCE', 'CN50',
  ] as const).map(
    (epic) => ({ epic, type: 'INDICES' as const }),
  ),
  ...([
    'EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
    'EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY', 'CADJPY', 'EURCHF', 'EURAUD',
    'GBPAUD', 'GBPCAD', 'AUDNZD', 'EURCAD', 'EURNZD', 'GBPNZD', 'CHFJPY', 'NZDJPY',
  ] as const).map((epic) => ({ epic, type: 'CURRENCIES' as const })),
  ...([
    'GOLD', 'SILVER', 'COPPER', 'OIL_BRENT', 'OIL_CRUDE', 'NATURALGAS',
    'PLATINUMROLLING', 'PALLADIUMROLLING', 'GASOIL', 'GASOLINE',
  ] as const).map((epic) => ({ epic, type: 'COMMODITIES' as const })),
  ...(['BTCUSD', 'ETHUSD'] as const).map((epic) => ({ epic, type: 'CRYPTOCURRENCIES' as const })),
];

/**
 * The markets the live engine is screened on, with the labels it would show.
 *
 * `UNIVERSE` above is a list of epics for the feature studies, which pool
 * thousands of observations and do not care what anything is called. This is a
 * different thing: the candidates for the board, in the shape the engine takes
 * them, so that the screen, the outcome breakdown and the strategy lab all run
 * over one list instead of four copies of it that drift apart.
 *
 * Every index Capital quotes is here, plus the commodities and crosses that
 * have been on the board or near it, so a comparison is against the whole field
 * rather than against whatever happens to be running today.
 */
export const CANDIDATE_MARKETS: InstrumentConfig[] = [
  { id: 'US30', epic: 'US30', label: 'US 30' },
  { id: 'US500', epic: 'US500', label: 'US 500' },
  { id: 'US100', epic: 'US100', label: 'US TECH 100' },
  { id: 'RTY', epic: 'RTY', label: 'US 2000' },
  { id: 'DE40', epic: 'DE40', label: 'GERMANY 40' },
  { id: 'UK100', epic: 'UK100', label: 'UK 100' },
  { id: 'FR40', epic: 'FR40', label: 'FRANCE 40' },
  { id: 'NL25', epic: 'NL25', label: 'NETHERLANDS 25' },
  { id: 'SP35', epic: 'SP35', label: 'SPAIN 35' },
  { id: 'SW20', epic: 'SW20', label: 'SWITZERLAND 20' },
  { id: 'J225', epic: 'J225', label: 'JAPAN 225' },
  { id: 'AU200', epic: 'AU200', label: 'AUSTRALIA 200' },
  { id: 'HK50', epic: 'HK50', label: 'HONG KONG 50' },
  { id: 'HSTECH', epic: 'HSTECH', label: 'HS TECH' },
  { id: 'HSCE', epic: 'HSCE', label: 'CHINA H-SHARES' },
  { id: 'CN50', epic: 'CN50', label: 'CHINA 50' },
  { id: 'GOLD', epic: 'GOLD', label: 'GOLD' },
  { id: 'SILVER', epic: 'SILVER', label: 'SILVER' },
  { id: 'COPPER', epic: 'COPPER', label: 'COPPER' },
  { id: 'BRENT', epic: 'OIL_BRENT', label: 'BRENT OIL' },
  { id: 'WTI', epic: 'OIL_CRUDE', label: 'WTI CRUDE' },
  { id: 'NATURALGAS', epic: 'NATURALGAS', label: 'NATURAL GAS' },
  { id: 'USDJPY', epic: 'USDJPY', label: 'USD/JPY' },
  { id: 'AUDJPY', epic: 'AUDJPY', label: 'AUD/JPY' },
  { id: 'GBPJPY', epic: 'GBPJPY', label: 'GBP/JPY' },
  { id: 'EURUSD', epic: 'EURUSD', label: 'EUR/USD' },
];

/**
 * The subset that produces enough signals to be judged at all.
 *
 * Measured on six weeks: the rest of the field either never fires or fires a
 * handful of times, and a market that takes four trades can post any number.
 */
export const ACTIVE_MARKETS: InstrumentConfig[] = CANDIDATE_MARKETS.filter((market) =>
  ['US30', 'US100', 'NL25', 'FR40', 'DE40', 'US500', 'J225', 'GOLD', 'BRENT', 'WTI', 'UK100'].includes(
    market.id,
  ),
);
