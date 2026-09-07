import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AUTH, type Role } from '@/lib/config';
import { HttpError } from '@/lib/http';
import { accounts, type SessionRow, type UserRow } from './store';

const derive = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_BYTES = 64;

/** A person, as everything above this module sees them. */
export interface User {
  id: number;
  login: string;
  role: Role;
  createdAt: number;
  lastSeenAt: number | null;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  login: row.login,
  role: row.role,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

/**
 * Passwords are stored as `salt:key`, never in the clear and never reversibly.
 * scrypt is deliberately slow, so a stolen table cannot be run through a word
 * list at any useful speed.
 */
async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, KEY_BYTES);
  return `${salt}:${key.toString('hex')}`;
}

/** Compared in constant time, so the comparison itself leaks nothing. */
async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  const actual = await derive(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A refusal the person can fix by typing something else, so 400 not 500. */
export class AuthError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

function validate(login: string, password: string | null) {
  const trimmed = login.trim();
  if (trimmed.length < AUTH.minLoginLength || trimmed.length > AUTH.maxLoginLength) {
    throw new AuthError(
      `Логин от ${AUTH.minLoginLength} до ${AUTH.maxLoginLength} символов`,
    );
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new AuthError('В логине только латиница, цифры, точка, дефис и подчёркивание');
  }
  if (password !== null && password.length < AUTH.minPasswordLength) {
    throw new AuthError(`Пароль от ${AUTH.minPasswordLength} символов`);
  }
  return trimmed;
}

export async function createUser(login: string, password: string, role: Role): Promise<User> {
  const name = validate(login, password);
  const existing = accounts()
    .prepare('SELECT id FROM users WHERE login = ?')
    .get(name) as { id: number } | undefined;
  if (existing) throw new AuthError('Такой логин уже занят');

  const result = accounts()
    .prepare('INSERT INTO users (login, password, role, created_at) VALUES (?, ?, ?, ?)')
    .run(name, await hashPassword(password), role, Date.now());

  return toUser(
    accounts().prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow,
  );
}

export function listUsers(): User[] {
  return (accounts().prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[]).map(
    toUser,
  );
}

export function countAdmins(): number {
  return (
    accounts().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as {
      n: number;
    }
  ).n;
}

/**
 * Removing an account also removes its sessions, so revoking access takes
 * effect on the next request rather than whenever the cookie happens to expire.
 * The last administrator cannot be removed or demoted: an install nobody can
 * administer is not recoverable from inside the app.
 */
export function deleteUser(id: number): void {
  const user = accounts().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) throw new AuthError('Такого пользователя нет');
  if (user.role === 'admin' && countAdmins() <= 1) {
    throw new AuthError('Это последний администратор, его нельзя удалить');
  }
  accounts().prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function setRole(id: number, role: Role): void {
  const user = accounts().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) throw new AuthError('Такого пользователя нет');
  if (user.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
    throw new AuthError('Это последний администратор, роль менять нельзя');
  }
  accounts().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

/** Changing a password drops that person's sessions, everywhere they are signed in. */
export async function setPassword(id: number, password: string): Promise<void> {
  if (password.length < AUTH.minPasswordLength) {
    throw new AuthError(`Пароль от ${AUTH.minPasswordLength} символов`);
  }
  accounts().prepare('UPDATE users SET password = ? WHERE id = ?').run(await hashPassword(password), id);
  accounts().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

/**
 * Checks a login and password.
 *
 * A wrong login and a wrong password are answered the same way, and both cost
 * the same time, so the form cannot be used to find out which accounts exist.
 */
export async function verifyCredentials(login: string, password: string): Promise<User | null> {
  const row = accounts().prepare('SELECT * FROM users WHERE login = ?').get(login.trim()) as
    | UserRow
    | undefined;

  if (!row) {
    // Spend the same work on a login that does not exist.
    await hashPassword(password);
    return null;
  }

  return (await passwordMatches(password, row.password)) ? toUser(row) : null;
}

/** Issues a session and returns the token to put in the cookie. */
export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + AUTH.sessionDays * 86_400_000;

  accounts()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, now, expiresAt);
  accounts().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

  return { token, expiresAt };
}

/** The person behind a session token, or null if it is unknown or expired. */
export function sessionUser(token: string | undefined): User | null {
  if (!token) return null;

  const session = accounts()
    .prepare('SELECT * FROM sessions WHERE token_hash = ?')
    .get(tokenHash(token)) as SessionRow | undefined;
  if (!session) return null;

  const now = Date.now();
  if (session.expires_at < now) {
    accounts().prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return null;
  }

  const row = accounts().prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as
    | UserRow
    | undefined;
  if (!row) return null;

  accounts().prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, row.id);
  return toUser(row);
}

export function endSession(token: string | undefined): void {
  if (token) accounts().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

/**
 * Creates the first administrator from the environment.
 *
 * Deliberately not a page: an install that hands the first visitor an admin
 * account is one open port away from being someone else's. The credentials come
 * from `ADMIN_LOGIN` and `ADMIN_PASSWORD`, and only when there is no account at
 * all, so restarting never resets anything.
 */
export async function bootstrapAdmin(): Promise<void> {
  const any = accounts().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (any.n > 0) return;

  const login = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;
  if (!login || !password) return;

  await createUser(login, password, 'admin');
}

/** True when nobody has been created yet, so the login page can say what to do. */
export function noAccountsYet(): boolean {
  return (accounts().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
}
