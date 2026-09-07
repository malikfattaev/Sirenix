import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/http';
import { signalStats } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ stats: signalStats() });
  } catch (error) {
    return errorResponse(error);
  }
}
