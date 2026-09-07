import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/http';
import { getNewsPulse } from '@/lib/news';
import { activeInstruments } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The headline reading for every market on the board.
 *
 * The feeds are shared and cached upstream, so asking for all of them at once
 * costs no more than asking for one.
 */
export async function GET() {
  try {
    await requireUser();
    const instruments = activeInstruments();
    const pulses = await Promise.all(instruments.map((instrument) => getNewsPulse(instrument)));

    return NextResponse.json({
      markets: instruments.map((instrument, index) => ({
        instrumentId: instrument.id,
        label: instrument.label,
        hasFeeds: Boolean(instrument.news),
        pulse: pulses[index],
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
