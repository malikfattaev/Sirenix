import { NEWS, type InstrumentConfig } from '@/lib/config';
import { readFeeds, type FeedItem } from './feed';
import { normalise, scoreText } from './sentiment';
import type { Headline, NewsPulse } from './types';

export type { Headline, NewsPulse } from './types';

const HOUR_MS = 3_600_000;

/** Where in a headline the instrument is named, or -1 when it is not. */
function mentionAt(text: string, terms: string[]): number {
  const haystack = normalise(text);
  const hits = terms
    .flatMap((term) => [haystack.indexOf(` ${term} `), haystack.indexOf(` ${term}s `)])
    .filter((at) => at >= 0);
  return hits.length === 0 ? -1 : Math.min(...hits);
}

/**
 * How much a headline is actually *about* this instrument.
 *
 * A market named in the opening words is the subject; one mentioned in a
 * trailing clause is usually background, which is what keeps a story about gold
 * that ends "and oil-driven inflation" from being read as an oil story.
 */
function prominence(item: FeedItem, terms: string[]): number {
  const inTitle = mentionAt(item.title, terms);
  if (inTitle >= 0) {
    const position = inTitle / Math.max(normalise(item.title).length, 1);
    return position <= 0.3 ? 1 : Math.max(0.25, 1 - (position - 0.3) / 0.7);
  }
  return mentionAt(item.summary, terms) >= 0 ? 0.25 : 0;
}

/** Weight halves every NEWS.halfLifeHours, so a stale headline fades out. */
const decay = (ageHours: number): number => 2 ** (-ageHours / NEWS.halfLifeHours);

const empty = (instrumentId: string, now: number): NewsPulse => ({
  instrumentId,
  sentiment: 0,
  count: 0,
  fresh: 0,
  burst: false,
  confidence: 0,
  headlines: [],
  updatedAt: now,
});

const pulses = new Map<string, NewsPulse>();

/**
 * Reads what the newswires are saying about one instrument.
 *
 * The reading is deliberately conservative: below a handful of matched
 * headlines the confidence collapses to zero, and headlines that disagree with
 * each other cancel out rather than averaging into a false lean.
 *
 * Scoring is memoised for a few seconds: the board polls every second, and
 * headlines do not change anywhere near that fast.
 */
export async function getNewsPulse(instrument: InstrumentConfig): Promise<NewsPulse> {
  const now = Date.now();
  if (!instrument.news) return empty(instrument.id, now);

  const previous = pulses.get(instrument.id);
  if (previous && now - previous.updatedAt < NEWS.pulseCacheMs) return previous;

  const items = await readFeeds(instrument.news.feeds);
  const cutoff = now - NEWS.windowHours * HOUR_MS;

  const terms = instrument.news.match;
  const relevant = items
    .filter((item) => item.publishedAt >= cutoff && item.publishedAt <= now + HOUR_MS)
    .map((item) => ({ item, weight: prominence(item, terms) }))
    .filter((row) => row.weight > 0)
    .sort((a, b) => b.item.publishedAt - a.item.publishedAt);

  const scored: Headline[] = relevant.map(({ item }) => ({
    id: item.url || `${item.source}:${item.title}`,
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt,
    // The title carries the verb that matters; the summary only breaks ties.
    sentiment: Number((0.75 * scoreText(item.title) + 0.25 * scoreText(item.summary)).toFixed(3)),
  }));

  if (scored.length === 0) {
    const blank = empty(instrument.id, now);
    pulses.set(instrument.id, blank);
    return blank;
  }

  const weights = scored.map(
    (headline, i) => decay((now - headline.publishedAt) / HOUR_MS) * relevant[i].weight,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const sentiment =
    total === 0 ? 0 : scored.reduce((sum, headline, i) => sum + headline.sentiment * weights[i], 0) / total;

  const fresh = scored.filter((headline) => now - headline.publishedAt <= NEWS.freshHours * HOUR_MS).length;
  const baselinePerHour = scored.length / NEWS.windowHours;
  const burst = baselinePerHour > 0 && fresh / NEWS.freshHours >= baselinePerHour * NEWS.burstRatio;

  // Confidence needs both a decent sample and headlines that agree: the mean of
  // the signed scores is only meaningful next to the mean of their magnitudes.
  const strength = scored.reduce((sum, headline, i) => sum + Math.abs(headline.sentiment) * weights[i], 0);
  const agreement = strength === 0 ? 0 : Math.abs(sentiment) / (strength / total);
  const sample = Math.min(1, scored.length / (NEWS.minHeadlines * 2));
  const confidence = scored.length < NEWS.minHeadlines ? 0 : Number((sample * agreement).toFixed(3));

  const pulse: NewsPulse = {
    instrumentId: instrument.id,
    sentiment: Number(sentiment.toFixed(3)),
    count: scored.length,
    fresh,
    burst,
    confidence,
    // Shown by how much the story is about this market, not merely by clock
    // time: a passing mention should not head the list.
    headlines: scored
      .map((headline, i) => ({ headline, weight: weights[i] }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, NEWS.maxHeadlines)
      .map((row) => row.headline),
    updatedAt: now,
  };
  pulses.set(instrument.id, pulse);
  return pulse;
}
