import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/http';
import { recentSkips, skipSummary } from '@/lib/db/skips';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser();
    const requested = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(requested) ? Math.trunc(Math.min(100, Math.max(1, requested))) : 50;
    return NextResponse.json({ skips: recentSkips(limit), summary: skipSummary(Date.now() - 86_400_000) });
  } catch (error) {
    return errorResponse(error);
  }
}
