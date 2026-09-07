import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/http';
import { DEFAULT_SETTINGS, INSTRUMENTS, SETTINGS_LIMITS, type Settings } from '@/lib/config';
import { cancelUntracked } from '@/lib/db';
import { getSettings, saveSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = (settings: Settings) => ({
  settings,
  defaults: DEFAULT_SETTINGS,
  limits: SETTINGS_LIMITS,
  markets: INSTRUMENTS.map((instrument) => ({ id: instrument.id, label: instrument.label })),
});

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(body(getSettings()));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Saves settings and squares the history with them.
 *
 * Taking a market off the board leaves its running signals with nobody to judge
 * them, since nothing fetches its candles any more. They are closed as
 * unevaluated rather than left sitting as open forecasts.
 */
export async function PUT(request: Request) {
  try {
    await requireUser();
    const patch = (await request.json()) as Partial<Settings>;
    const settings = saveSettings(patch);
    cancelUntracked(settings.markets);
    return NextResponse.json(body(settings));
  } catch (error) {
    return errorResponse(error);
  }
}
