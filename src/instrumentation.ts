/**
 * Next's one hook that runs when the server starts, and only on the server.
 *
 * The analysis loop is started from here rather than from a route, because a
 * route only runs when somebody asks for it, and the whole point of the loop is
 * to run when nobody does. The Edge runtime has no place for a long-lived
 * timer, and neither does the build, so both are left alone.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.BACKGROUND_ANALYSIS === 'off') return;

  const { startAnalysisLoop } = await import('@/lib/scheduler');
  startAnalysisLoop();
}
