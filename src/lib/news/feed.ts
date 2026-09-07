import { NEWS, NEWS_FEEDS, type NewsFeedConfig } from '@/lib/config';

/** One entry as it comes off a feed, before any instrument matching. */
export interface FeedItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
}

interface CacheEntry {
  items: FeedItem[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<FeedItem[]>>();

const decodeEntities = (text: string): string =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    // Numeric references, decimal and hexadecimal: publishers use both, often
    // for the curly quotes and dashes that fill financial headlines.
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

/** Strips markup a feed may leave inside a description. */
const stripTags = (text: string): string => decodeEntities(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function tagContent(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? stripTags(match[1]) : null;
}

/** Atom feeds put the address in an attribute rather than the element body. */
function linkOf(block: string): string {
  const href = block.match(/<link[^>]*\shref=["']([^"']+)["']/i);
  if (href) return decodeEntities(href[1]);
  return tagContent(block, 'link') ?? '';
}

/** Minimal RSS 2.0 and Atom reader; anything unparseable is skipped. */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];

  return blocks.flatMap((block) => {
    const title = tagContent(block, 'title');
    if (!title) return [];

    const date =
      tagContent(block, 'pubDate') ??
      tagContent(block, 'published') ??
      tagContent(block, 'updated') ??
      tagContent(block, 'dc:date');
    const publishedAt = date ? Date.parse(date) : Number.NaN;
    if (!Number.isFinite(publishedAt)) return [];

    return [
      {
        title,
        summary: tagContent(block, 'description') ?? tagContent(block, 'summary') ?? '',
        url: linkOf(block),
        source,
        publishedAt,
      },
    ];
  });
}

async function download(feed: NewsFeedConfig): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWS.requestTimeoutMs);
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      cache: 'no-store',
      // Several publishers reject the default runtime agent outright.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sirenix/1.0)', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!response.ok) return [];
    return parseFeed(await response.text(), feed.label);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads one feed, at most once per cache window. A feed that fails keeps
 * serving its last good items rather than blanking the news out entirely.
 */
export async function readFeed(id: string): Promise<FeedItem[]> {
  const feed = NEWS_FEEDS.find((candidate) => candidate.id === id);
  if (!feed) return [];

  const cached = cache.get(id);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < NEWS.cacheMs) return cached.items;

  const pending = inFlight.get(id);
  if (pending) return pending;

  const task = download(feed)
    .then((items) => {
      if (items.length === 0 && cached) return cached.items;
      cache.set(id, { items, fetchedAt: Date.now() });
      return items;
    })
    .finally(() => inFlight.delete(id));

  inFlight.set(id, task);
  return task;
}

/**
 * Every feed named by an instrument, fetched in parallel and de-duplicated.
 *
 * Syndicated stories reach several feeds under different addresses, so the
 * headline text is the identity that matters, not the link.
 */
export async function readFeeds(ids: string[]): Promise<FeedItem[]> {
  const batches = await Promise.all(ids.map((id) => readFeed(id)));
  const seen = new Set<string>();

  return batches.flat().filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
