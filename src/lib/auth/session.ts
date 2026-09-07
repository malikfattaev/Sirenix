import { cookies } from 'next/headers';
import { AUTH } from '@/lib/config';
import { HttpError } from '@/lib/http';
import { bootstrapAdmin, sessionUser, type User } from './index';

/**
 * Who is making this request, or null.
 *
 * The bootstrap runs here because this is the one place every request passes
 * through: an install started with `ADMIN_LOGIN` and `ADMIN_PASSWORD` set has
 * its administrator before the first login form is ever answered.
 */
export async function currentUser(): Promise<User | null> {
  await bootstrapAdmin();
  const store = await cookies();
  return sessionUser(store.get(AUTH.cookieName)?.value);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Нужен вход');
  return user;
}

/** Everything about accounts is administrators only, reads included. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new HttpError(403, 'Доступно только администратору');
  return user;
}
