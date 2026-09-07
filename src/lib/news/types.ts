export interface Headline {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  /** Directional reading of this headline alone, -1 bearish to +1 bullish. */
  sentiment: number;
}

/** What the headlines are saying about one instrument right now. */
export interface NewsPulse {
  instrumentId: string;
  /** Recency-weighted mean sentiment across matched headlines, -1 to +1. */
  sentiment: number;
  /** Matched headlines inside the window. */
  count: number;
  /** Matched headlines inside the fresh window. */
  fresh: number;
  /** True when coverage is running well above its own recent rate. */
  burst: boolean;
  /** How far the reading can be trusted, 0-1, from headline count and agreement. */
  confidence: number;
  headlines: Headline[];
  updatedAt: number;
}
