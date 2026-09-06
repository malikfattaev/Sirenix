import { NextResponse } from 'next/server';
import { analyseAllInstruments } from '@/lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const signals = await analyseAllInstruments();
    return NextResponse.json({ signals, updatedAt: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
