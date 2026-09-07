import { LEXICON, NEGATORS } from './lexicon';

/** Chars before a phrase that are searched for a negation. */
const NEGATION_WINDOW = 14;

/** Lowercase, strip punctuation and pad, so phrases can be matched on word boundaries. */
export function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9%$.]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Reads one headline as a number from -1 (price down) to +1 (price up).
 *
 * Matched phrases are blanked out as they are consumed, so a long phrase always
 * wins over the shorter ones inside it and nothing is counted twice.
 */
export function scoreText(text: string): number {
  let haystack = normalise(text);
  let total = 0;

  for (const { phrase, weight } of LEXICON) {
    const needle = ` ${phrase} `;
    for (;;) {
      const at = haystack.indexOf(needle);
      if (at === -1) break;
      const before = haystack.slice(Math.max(0, at - NEGATION_WINDOW), at + 1);
      const negated = NEGATORS.some((negator) => before.includes(` ${negator} `));
      total += negated ? -weight : weight;
      haystack = `${haystack.slice(0, at + 1)}${' '.repeat(phrase.length)}${haystack.slice(at + needle.length - 1)}`;
    }
  }

  // Squashed rather than clipped: a fourth bullish word should matter less than
  // the first, but must not push an already strong headline off the scale.
  return Math.tanh(total / 2);
}
