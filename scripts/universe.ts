/** Shared definitions for the research scripts: the traded universe and the feature list. */

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
