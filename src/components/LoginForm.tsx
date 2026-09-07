'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LoginForm({ empty }: { empty: boolean }) {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Не удалось войти');
      router.replace('/');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти');
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-3xl font-semibold tracking-[0.3em]">SIRENIX</h1>
        <div className="mx-auto mt-5 h-px w-16 bg-edge" />

        {empty ? (
          <p className="mt-8 rounded-xl border border-edge bg-surface p-5 text-[13px] leading-relaxed text-muted">
            Ни одного пользователя ещё нет. Задайте переменные окружения{' '}
            <code className="text-neutral-300">ADMIN_LOGIN</code> и{' '}
            <code className="text-neutral-300">ADMIN_PASSWORD</code> и перезапустите сервер: первый
            администратор создастся из них. Через страницу это не делается намеренно, иначе
            администратором стал бы любой, кто первым откроет адрес.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              placeholder="логин"
              autoComplete="username"
              autoFocus
              className="w-full rounded-lg border border-edge bg-surface px-4 py-2.5 text-[14px] text-neutral-100 outline-none transition placeholder:text-muted focus:border-neutral-600"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="пароль"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-lg border border-edge bg-surface px-4 py-2.5 text-[14px] text-neutral-100 outline-none transition placeholder:text-muted focus:border-neutral-600"
            />

            {error && <p className="text-[13px] text-short">{error}</p>}

            <button
              type="submit"
              disabled={busy || login.length === 0 || password.length === 0}
              className="w-full rounded-lg border border-edge bg-surface-raised px-4 py-2.5 text-[13px] font-medium text-neutral-200 transition hover:border-neutral-600 disabled:opacity-40"
            >
              {busy ? 'Захожу…' : 'Войти'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
