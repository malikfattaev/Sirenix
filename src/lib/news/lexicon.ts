/**
 * Directional vocabulary for commodity headlines.
 *
 * Weights read as "how strongly does this phrase say the price is going up",
 * so a supply disruption is positive for oil and a hawkish central bank is
 * negative for gold. Longer phrases are matched first and consume the text they
 * cover, so "rate cut" never also scores as a bare "cut".
 */
export interface LexiconEntry {
  phrase: string;
  weight: number;
}

const BULLISH: [string, number][] = [
  // Price action
  ['record high', 1.2], ['all time high', 1.2], ['all-time high', 1.2],
  ['surges', 1.0], ['surge', 1.0], ['soars', 1.0], ['soar', 1.0], ['spikes', 1.0],
  ['rallies', 0.9], ['rally', 0.9], ['jumps', 0.9], ['jump', 0.9], ['rockets', 1.0],
  ['climbs', 0.8], ['climb', 0.8], ['rises', 0.8], ['rise', 0.7], ['rising', 0.7],
  ['gains', 0.7], ['gain', 0.6], ['advances', 0.6], ['advance', 0.5],
  ['extends gains', 1.0], ['tops', 0.7], ['breaks above', 0.9], ['breaks out', 0.8],
  ['higher', 0.6], ['firmer', 0.6], ['strengthens', 0.7], ['strengthen', 0.6],
  ['rebounds', 0.7], ['rebound', 0.6], ['recovers', 0.6], ['upside', 0.5],
  ['bullish', 0.9], ['bulls', 0.7], ['bull market', 0.8], ['upbeat', 0.5],
  ['buying', 0.4], ['demand surge', 1.0], ['strong demand', 0.8], ['demand growth', 0.6],

  // Supply and geopolitics, which move oil hardest
  ['supply disruption', 1.0], ['supply cut', 0.9], ['output cut', 0.9],
  ['production cut', 0.9], ['opec cut', 1.0], ['supply shortage', 1.0],
  ['shortage', 0.7], ['deficit', 0.6], ['tightening', 0.6], ['tighter supply', 0.9],
  ['inventory draw', 0.8], ['stockpile draw', 0.8], ['drawdown', 0.6],
  ['sanctions', 0.7], ['embargo', 0.8], ['blockade', 0.9], ['outage', 0.7],
  ['escalates', 0.8], ['escalation', 0.8], ['attack', 0.7], ['strikes', 0.6],
  ['tensions', 0.5], ['geopolitical risk', 0.6], ['conflict', 0.5], ['war', 0.5],
  ['halts exports', 0.9], ['export ban', 0.9], ['force majeure', 0.8],

  // Macro backdrop that lifts gold
  ['safe haven', 0.7], ['safe-haven', 0.7], ['rate cut', 0.7], ['rate cuts', 0.7],
  ['dovish', 0.7], ['weaker dollar', 0.7], ['dollar falls', 0.7], ['dollar weakens', 0.7],
  ['inflation concerns', 0.5], ['inflation fears', 0.6], ['stimulus', 0.5],
  ['central bank buying', 0.8],
];

const BEARISH: [string, number][] = [
  // Price action
  ['plunges', 1.0], ['plunge', 1.0], ['crashes', 1.1], ['collapses', 1.0],
  ['tumbles', 0.9], ['tumble', 0.9], ['slumps', 0.9], ['slump', 0.9],
  ['sinks', 0.8], ['sink', 0.8], ['slides', 0.8], ['slide', 0.7],
  ['falls', 0.8], ['fall', 0.6], ['drops', 0.8], ['drop', 0.6], ['declines', 0.7],
  ['decline', 0.6], ['retreats', 0.6], ['retreat', 0.5], ['eases', 0.5], ['ease', 0.4],
  ['extends losses', 1.0], ['losses', 0.5], ['lower', 0.6], ['weakens', 0.7],
  ['weaker', 0.6], ['softens', 0.5], ['under pressure', 0.7], ['pressured', 0.6],
  ['selloff', 0.9], ['sell-off', 0.9], ['profit taking', 0.6], ['profit-taking', 0.6],
  ['correction', 0.5], ['bearish', 0.9], ['bears', 0.7], ['bear market', 0.8],
  ['breaks below', 0.9], ['downside', 0.5], ['slips', 0.6], ['slip', 0.5],

  // Supply and geopolitics
  ['oversupply', 1.0], ['supply glut', 1.0], ['glut', 0.9], ['surplus', 0.7],
  ['output increase', 0.8], ['production increase', 0.8], ['output hike', 0.8],
  ['opec increases', 0.9], ['raises output', 0.8], ['boosts output', 0.8],
  ['inventory build', 0.8], ['stockpile build', 0.8], ['builds', 0.5],
  ['ceasefire', 0.9], ['truce', 0.8], ['peace deal', 0.9], ['de-escalation', 0.8],
  ['deescalation', 0.8], ['eases tensions', 0.7], ['resume exports', 0.8],
  ['restart', 0.5], ['sanctions lifted', 0.9], ['sanctions relief', 0.8],
  ['weak demand', 0.9], ['demand slowdown', 0.8], ['demand destruction', 1.0],

  // Macro backdrop that weighs on gold
  ['hawkish', 0.7], ['rate hike', 0.7], ['rate hikes', 0.7], ['higher yields', 0.6],
  ['rising yields', 0.6], ['stronger dollar', 0.7], ['dollar rises', 0.7],
  ['dollar strengthens', 0.7], ['risk appetite', 0.5], ['risk-on', 0.5],
];

/** Words that flip the phrase that follows them. */
export const NEGATORS = ['not', 'no', 'never', 'without', 'fails to', 'failed to', 'unlikely'];

export const LEXICON: LexiconEntry[] = [
  ...BULLISH.map(([phrase, weight]) => ({ phrase, weight })),
  ...BEARISH.map(([phrase, weight]) => ({ phrase, weight: -weight })),
].sort((a, b) => b.phrase.length - a.phrase.length);
