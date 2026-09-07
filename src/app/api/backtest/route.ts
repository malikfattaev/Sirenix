import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest/engine';
import { runSwingBacktest } from '@/lib/backtest/swing';
import { INSTRUMENTS, findInstrument } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Replaying several days of one-minute candles takes a while. */
export const maxDuration = 120;

const MAX_DAYS = 210;
/** The minute-scale replay is far heavier, so it covers a shorter window. */
const MAX_SCALP_DAYS = 10;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedDays = Number(params.get('days') ?? 5);
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), MAX_DAYS) : 5;

  const id = params.get('instrument');
  const instruments = id ? [findInstrument(id)].filter((i) => i !== undefined) : INSTRUMENTS;
  if (instruments.length === 0) {
    return NextResponse.json({ error: `Unknown instrument "${id}"` }, { status: 400 });
  }

  try {
    const swing = await runSwingBacktest(days);

    // Sequential on purpose: each minute-scale run pulls thousands of candles.
    const scalpDays = Math.min(days, MAX_SCALP_DAYS);
    const results = [];
    for (const instrument of instruments) {
      const result = await runBacktest(instrument, { days: scalpDays });
      // The full trade list is large and unused by the UI.
      results.push({ ...result, trades: undefined });
    }
    return NextResponse.json({ days, scalpDays, swing, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
