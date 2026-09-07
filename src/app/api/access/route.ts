import { NextResponse } from 'next/server';
import { createUser, deleteUser, listUsers, setPassword, setRole } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth/session';
import type { Role } from '@/lib/config';
import { errorResponse, HttpError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isRole = (value: unknown): value is Role => value === 'admin' || value === 'user';

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ users: listUsers() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as { login?: string; password?: string; role?: string };
    if (!body.login || !body.password) throw new HttpError(400, 'Нужны логин и пароль');
    if (!isRole(body.role)) throw new HttpError(400, 'Неизвестная роль');

    await createUser(body.login, body.password, body.role);
    return NextResponse.json({ users: listUsers() });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Changes one account. An administrator can move someone between roles and
 * reset a password, but never their way into somebody's existing password:
 * a reset replaces it and signs that person out everywhere.
 */
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as { id?: number; role?: string; password?: string };
    if (typeof body.id !== 'number') throw new HttpError(400, 'Не указан пользователь');

    if (body.role !== undefined) {
      if (!isRole(body.role)) throw new HttpError(400, 'Неизвестная роль');
      setRole(body.id, body.role);
    }
    if (body.password !== undefined) await setPassword(body.id, body.password);

    return NextResponse.json({ users: listUsers() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isInteger(id)) throw new HttpError(400, 'Не указан пользователь');
    if (id === admin.id) throw new HttpError(400, 'Нельзя удалить самого себя');

    deleteUser(id);
    return NextResponse.json({ users: listUsers() });
  } catch (error) {
    return errorResponse(error);
  }
}
