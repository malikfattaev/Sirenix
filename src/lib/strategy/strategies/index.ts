import type { Strategy } from '../types';
import { breakoutRetest } from './breakoutRetest';
import { failedBreakout } from './failedBreakout';
import { meanReversion } from './meanReversion';
import { momentum } from './momentum';
import { newsDrive } from './newsDrive';
import { openingRange } from './openingRange';
import { pullbackFade } from './pullbackFade';
import { srBounce } from './srBounce';
import { trendPullback } from './trendPullback';
import { vwapPullback } from './vwapPullback';

/** Every setup the system knows how to recognise. */
export const STRATEGIES: Strategy[] = [
  trendPullback,
  pullbackFade,
  breakoutRetest,
  momentum,
  newsDrive,
  vwapPullback,
  srBounce,
  meanReversion,
  failedBreakout,
  openingRange,
];

export const STRATEGY_LABELS = Object.fromEntries(
  STRATEGIES.map((strategy) => [strategy.key, strategy.label]),
) as Record<Strategy['key'], string>;
