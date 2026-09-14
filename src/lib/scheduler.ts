import { ANALYSIS_LOOP } from '@/lib/config';
import { getQuotes } from '@/lib/quotes';
import { analyseAllInstruments } from '@/lib/service';

/**
 * The analysis loop: the server's reason to run when nobody is watching.
 *
 * Without it the engine only thinks while a browser is polling it, which makes
 * the signal history a record of when someone had the page open rather than of
 * what the market did. It also leaves open signals unjudged, because a stop or
 * a target is only checked inside a sweep.
 *
 * One sweep is exactly what a page load asks for, so this adds no new path
 * through the engine — only a clock.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Analyses every market once and says how long to wait before doing it again.
 *
 * The quotes are read a second time to decide that, which costs nothing: the
 * sweep has just filled the quote cache, and this is served from it.
 */
async function sweep(): Promise<number> {
  await analyseAllInstruments();
  const quotes = await getQuotes();
  return quotes.some((quote) => quote.open)
    ? ANALYSIS_LOOP.openIntervalMs
    : ANALYSIS_LOOP.closedIntervalMs;
}

/**
 * Starts the loop, once per process.
 *
 * Each sweep schedules the next one only after it has finished, so a slow call
 * upstream delays the loop instead of stacking a second sweep on top of it. A
 * sweep that throws is a broker that is unreachable this minute, not a reason
 * to stop: it is logged, and the loop backs off and tries again.
 */
export function startAnalysisLoop(): void {
  if (timer || running) return;
  running = true;

  const run = async () => {
    let wait: number = ANALYSIS_LOOP.retryIntervalMs;
    try {
      wait = await sweep();
    } catch (error) {
      console.error('[analysis] sweep failed:', error instanceof Error ? error.message : error);
    }
    timer = setTimeout(run, wait);
  };

  timer = setTimeout(run, ANALYSIS_LOOP.startupDelayMs);
  console.log('[analysis] loop started');
}

/** Stops the loop. Only the tests need this; the server runs until it is killed. */
export function stopAnalysisLoop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
}
