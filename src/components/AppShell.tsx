'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { User } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/config';
import { useMarketData } from './MarketData';

/** 16px stroke icons, drawn inline so the shell pulls in no icon package. */
const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <path d="M3 13h4v6H3zM10 5h4v14h-4zM17 9h4v10h-4z" />
    </>
  ),
  signals: (
    <>
      <path d="M2 12h4l3 7 5-15 3 8h5" />
    </>
  ),
  news: (
    <>
      <path d="M4 5h11v14H4zM15 9h5v8a2 2 0 0 1-4 0V9M7 8h5M7 11h5M7 14h5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M8 15v4" />
    </>
  ),
  access: (
    <>
      <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M17 8h5M19.5 5.5v5" />
    </>
  ),
};

/**
 * The modules, in sections.
 *
 * `Итог` is what already happened, `Рынок` is what is happening now, and
 * `Система` is what a person changes rather than reads. `admin` marks a module
 * that is not merely hidden from everyone else: its page and its routes refuse
 * the request as well.
 */
const SECTIONS: {
  title: string;
  modules: { href: string; icon: string; label: string; admin?: boolean }[];
}[] = [
  {
    title: 'Итог',
    modules: [{ href: '/', icon: 'dashboard', label: 'Дешборд' }],
  },
  {
    title: 'Рынок',
    modules: [
      { href: '/signals', icon: 'signals', label: 'Сигналы' },
      { href: '/news', icon: 'news', label: 'Новости' },
    ],
  },
  {
    title: 'Система',
    modules: [
      { href: '/settings', icon: 'settings', label: 'Настройки' },
      { href: '/access', icon: 'access', label: 'Доступ', admin: true },
    ],
  },
];

function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

/** A module is current when the path is it, or sits under it. */
const isCurrent = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname.startsWith(href);

export function AppShell({ children, user }: { children: React.ReactNode; user: User }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signals, error } = useMarketData();
  const [leaving, setLeaving] = useState(false);

  const live = signals.filter((signal) => signal.type !== 'WAIT').length;
  const sections = SECTIONS.map((section) => ({
    ...section,
    modules: section.modules.filter((module) => !module.admin || user.role === 'admin'),
  })).filter((section) => section.modules.length > 0);

  const signOut = async () => {
    setLeaving(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const item = (module: { href: string; icon: string; label: string }, compact = false) => {
    const current = isCurrent(pathname, module.href);
    return (
      <Link
        key={module.href}
        href={module.href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition ${
          compact ? 'whitespace-nowrap py-1.5' : ''
        } ${
          current
            ? 'bg-surface-raised text-neutral-100'
            : 'text-muted hover:bg-surface-raised/50 hover:text-neutral-300'
        }`}
      >
        <Icon name={module.icon} />
        <span className={compact ? '' : 'flex-1'}>{module.label}</span>
        {!compact && module.href === '/signals' && live > 0 && (
          <span className="tabular rounded-full bg-long/15 px-1.5 py-0.5 text-[11px] text-long">
            {live}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-edge bg-surface md:flex">
        <div className="py-7">
          <Link href="/" className="block text-center text-2xl font-semibold tracking-[0.28em]">
            SIRENIX
          </Link>
          <div className="mx-auto mt-5 h-px w-16 bg-edge" />
        </div>

        <nav className="flex flex-1 flex-col gap-6 px-3">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="px-3 pb-1.5 text-[10px] uppercase tracking-[0.2em] text-muted/70">
                {section.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {section.modules.map((module) => item(module))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-edge px-5 py-4">
          <div className="truncate text-[12px] text-neutral-300">{user.login}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">{ROLE_LABEL[user.role]}</span>
            <button
              type="button"
              onClick={signOut}
              disabled={leaving}
              className="text-[11px] text-muted transition hover:text-neutral-300 disabled:opacity-50"
            >
              {leaving ? 'выхожу…' : 'выйти'}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto border-b border-edge bg-surface px-3 py-2 md:hidden">
          {sections.flatMap((section) => section.modules).map((module) => item(module, true))}
          <button
            type="button"
            onClick={signOut}
            disabled={leaving}
            className="ml-auto whitespace-nowrap px-3 py-1.5 text-[13px] text-muted disabled:opacity-50"
          >
            выйти
          </button>
        </nav>

        <main className="mx-auto w-full max-w-5xl px-5 py-8">
          {error && (
            <p className="mb-6 rounded-lg border border-short/40 bg-short/10 px-4 py-3 text-[13px] text-short">
              {error}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

/** The heading every module opens with, so the pages stay consistent. */
export function ModuleHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-sm font-semibold tracking-[0.15em] text-neutral-300">{title}</h1>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </header>
  );
}
