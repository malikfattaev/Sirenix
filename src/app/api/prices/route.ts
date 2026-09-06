import { NextResponse } from 'next/server';
import { getQuotes } from '@/lib/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ quotes: await getQuotes() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
