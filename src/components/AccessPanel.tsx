'use client';

import { useCallback, useState } from 'react';
import { AUTH, ROLE_LABEL, type Role } from '@/lib/config';
import type { User } from '@/lib/auth';
import { usePoll } from './MarketData';
import { dateTime } from './format';

const ROLES: Role[] = ['admin', 'user'];

const REFRESH_MS = 15_000;

function RoleChip({
  role,
  active,
  onClick,
  disabled,
}: {
  role: Role;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-surface-raised text-neutral-100' : 'text-muted hover:text-neutral-300'
      }`}
    >
      {ROLE_LABEL[role]}
    </button>
  );
}

const input =
  'rounded-lg border border-edge bg-surface-raised px-3 py-1.5 text-[13px] text-neutral-100 outline-none transition placeholder:text-muted focus:border-neutral-600';

export function AccessPanel({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');

  /** Whose password is being reset, and to what. */
  const [resetting, setResetting] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/access', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Не удалось загрузить список');
      setUsers(body.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить список');
    }
  }, []);

  usePoll(load, REFRESH_MS);

  const send = async (method: string, path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const answer = await response.json();
      if (!response.ok) throw new Error(answer.error ?? 'Не получилось');
      setUsers(answer.users);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не получилось');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (await send('POST', '/api/access', { login, password, role })) {
      setLogin('');
      setPassword('');
      setRole('user');
    }
  };

  const resetPassword = async (id: number) => {
    if (await send('PATCH', '/api/access', { id, password: newPassword })) {
      setResetting(null);
      setNewPassword('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-surface p-5">
        <h2 className="text-[11px] uppercase tracking-wider text-muted">Новый пользователь</h2>
        <p className="mt-1 text-[12px] text-muted">
          Логин от {AUTH.minLoginLength} символов, латиница и цифры. Пароль от{' '}
          {AUTH.minPasswordLength} символов. Показать его потом будет нельзя, только задать новый.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="логин"
            autoComplete="off"
            className={`${input} w-40`}
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="пароль"
            type="password"
            autoComplete="new-password"
            className={`${input} w-48`}
          />
          <div className="flex overflow-hidden rounded-lg border border-edge">
            {ROLES.map((option) => (
              <RoleChip
                key={option}
                role={option}
                active={role === option}
                onClick={() => setRole(option)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={create}
            disabled={busy || login.length === 0 || password.length === 0}
            className="rounded-lg border border-edge bg-surface-raised px-4 py-1.5 text-[12px] font-medium text-neutral-200 transition hover:border-neutral-600 disabled:opacity-40"
          >
            Создать
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-short">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wider text-muted">
            <tr className="border-b border-edge">
              <th className="px-4 py-3 font-medium">Логин</th>
              <th className="px-4 py-3 font-medium">Роль</th>
              <th className="px-4 py-3 font-medium">Создан</th>
              <th className="px-4 py-3 font-medium">Заходил</th>
              <th className="px-4 py-3 text-right font-medium">Что сделать</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {(users ?? []).map((user) => {
              const self = user.id === currentUserId;
              return (
                <tr key={user.id}>
                  <td className="px-4 py-2.5 text-neutral-200">
                    {user.login}
                    {self && <span className="ml-2 text-[11px] text-muted">это вы</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex w-fit overflow-hidden rounded-lg border border-edge">
                      {ROLES.map((option) => (
                        <RoleChip
                          key={option}
                          role={option}
                          active={user.role === option}
                          disabled={busy || self}
                          onClick={() => send('PATCH', '/api/access', { id: user.id, role: option })}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="tabular px-4 py-2.5 text-muted">{dateTime(user.createdAt)}</td>
                  <td className="tabular px-4 py-2.5 text-muted">
                    {user.lastSeenAt === null ? 'ни разу' : dateTime(user.lastSeenAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      {resetting === user.id ? (
                        <>
                          <input
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            placeholder="новый пароль"
                            type="password"
                            autoComplete="new-password"
                            className={`${input} w-40`}
                          />
                          <button
                            type="button"
                            onClick={() => resetPassword(user.id)}
                            disabled={busy}
                            className="rounded-lg border border-edge bg-surface-raised px-3 py-1.5 text-[12px] text-neutral-200 transition hover:border-neutral-600 disabled:opacity-40"
                          >
                            Задать
                          </button>
                          <button
                            type="button"
                            onClick={() => setResetting(null)}
                            className="text-[12px] text-muted transition hover:text-neutral-300"
                          >
                            Отмена
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setResetting(user.id);
                              setNewPassword('');
                            }}
                            className="text-[12px] text-muted transition hover:text-neutral-300"
                          >
                            Сменить пароль
                          </button>
                          {!self && (
                            <button
                              type="button"
                              onClick={() => send('DELETE', `/api/access?id=${user.id}`)}
                              disabled={busy}
                              className="text-[12px] text-muted transition hover:text-short disabled:opacity-40"
                            >
                              Удалить
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
