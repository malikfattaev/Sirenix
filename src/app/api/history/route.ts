import { NextResponse } from 'next/server';
import { recentSignals } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : 20;

  try {
    return NextResponse.json({ signals: recentSignals(limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
