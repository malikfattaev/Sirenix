import { NextResponse } from 'next/server';
import { bootstrapAdmin, createSession, verifyCredentials } from '@/lib/auth';
import { AUTH } from '@/lib/config';
import { errorResponse, HttpError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await bootstrapAdmin();
    const { login, password } = (await request.json()) as { login?: string; password?: string };
    if (!login || !password) throw new HttpError(400, 'Введите логин и пароль');

    const user = await verifyCredentials(login, password);
    // One message for both cases, so the form cannot be used to find out which
    // logins exist.
    if (!user) throw new HttpError(401, 'Неверный логин или пароль');

    const session = createSession(user.id);
    const response = NextResponse.json({ user });
    response.cookies.set({
      name: AUTH.cookieName,
      value: session.token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(session.expiresAt),
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
