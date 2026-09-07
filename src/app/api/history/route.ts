import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/http';
import { HISTORY } from '@/lib/config';
import { clearHistory, recentSignals } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? HISTORY.limit);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : HISTORY.limit;

  try {
    await requireUser();
    return NextResponse.json({ signals: recentSignals(limit) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Wipes the settled history. Signals still running are kept; see `clearHistory`. */
export async function DELETE() {
  try {
    await requireUser();
    return NextResponse.json(clearHistory());
  } catch (error) {
    return errorResponse(error);
  }
}
