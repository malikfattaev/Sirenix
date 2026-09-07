import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/http';
import { getQuotes } from '@/lib/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ quotes: await getQuotes() });
  } catch (error) {
    return errorResponse(error, 502);
  }
}
