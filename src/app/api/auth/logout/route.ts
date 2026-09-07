import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { endSession } from '@/lib/auth';
import { AUTH } from '@/lib/config';
import { errorResponse } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const store = await cookies();
    endSession(store.get(AUTH.cookieName)?.value);

    const response = NextResponse.json({ ok: true });
    response.cookies.set({ name: AUTH.cookieName, value: '', path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
