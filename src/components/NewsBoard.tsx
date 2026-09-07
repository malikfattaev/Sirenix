'use client';

import { useCallback, useState } from 'react';
import { NEWS_REFRESH_INTERVAL_MS } from '@/lib/config';
import type { NewsPulse } from '@/lib/news/types';
import { usePoll } from './MarketData';

interface MarketNews {
  instrumentId: string;
  label: string;
  hasFeeds: boolean;
  pulse: NewsPulse;
}

const lean = (sentiment: number) =>
  sentiment > 0.05 ? 'ЗА РОСТ' : sentiment < -0.05 ? 'ЗА ПАДЕНИЕ' : 'СМЕШАННО';

const tone = (sentiment: number) =>
  sentiment > 0.05 ? 'text-long' : sentiment < -0.05 ? 'text-short' : 'text-neutral-400';

const ago = (timestamp: number) => {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ч назад` : `${Math.round(hours / 24)} д назад`;
};

/** A bar for how far the reading leans, drawn from the middle out. */
function Lean({ sentiment, confidence }: { sentiment: number; confidence: number }) {
  const width = Math.min(Math.abs(sentiment), 1) * 50;

  return (
    <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
      <div className="absolute inset-y-0 left-1/2 w-px bg-edge" />
      <div
        className={`absolute inset-y-0 ${sentiment >= 0 ? 'left-1/2' : 'right-1/2'} ${
          sentiment > 0.05 ? 'bg-long' : sentiment < -0.05 ? 'bg-short' : 'bg-wait'
        }`}
        style={{ width: `${width}%`, opacity: 0.35 + 0.65 * confidence }}
      />
    </div>
  );
}

function Card({ market }: { market: MarketNews }) {
  const { pulse } = market;

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-neutral-200">{market.label}</h3>
        {market.hasFeeds && pulse.count > 0 && (
          <span className={`tabular text-[11px] font-medium ${tone(pulse.sentiment)}`}>
            {lean(pulse.sentiment)} {pulse.sentiment > 0 ? '+' : ''}
            {pulse.sentiment.toFixed(2)}
          </span>
        )}
      </div>

      {!market.hasFeeds ? (
        <p className="mt-3 text-[12px] text-muted">Лент для этого рынка не подключено.</p>
      ) : pulse.count === 0 ? (
        <p className="mt-3 text-[12px] text-muted">
          За последние часы про этот рынок ничего не писали.
        </p>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>{pulse.count} новостей</span>
            <span>свежих {pulse.fresh}</span>
            <span>уверенность {Math.round(pulse.confidence * 100)}%</span>
            {pulse.burst && (
              <span className="rounded-full bg-wait/15 px-2 py-0.5 text-neutral-300">
                поток выше обычного
              </span>
            )}
          </div>

          <Lean sentiment={pulse.sentiment} confidence={pulse.confidence} />

          <ul className="mt-4 space-y-2">
            {pulse.headlines.map((headline) => (
              <li key={headline.id} className="flex gap-2 text-[12px] leading-snug">
                <span className={`tabular shrink-0 ${tone(headline.sentiment)}`}>
                  {headline.sentiment > 0 ? '+' : ''}
                  {headline.sentiment.toFixed(2)}
                </span>
                <span className="min-w-0">
                  <a
                    href={headline.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-400 transition hover:text-neutral-200"
                  >
                    {headline.title}
                  </a>
                  <span className="ml-2 whitespace-nowrap text-[11px] text-muted">
                    {headline.source} · {ago(headline.publishedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function NewsBoard() {
  const [markets, setMarkets] = useState<MarketNews[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/news', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Не удалось загрузить новости');
      setMarkets(body.markets);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить новости');
    }
  }, []);

  usePoll(load, NEWS_REFRESH_INTERVAL_MS);

  if (error) {
    return (
      <p className="rounded-xl border border-short/40 bg-short/10 px-4 py-3 text-[13px] text-short">
        {error}
      </p>
    );
  }

  if (!markets) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-56 animate-pulse rounded-xl border border-edge bg-surface" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {markets.map((market) => (
        <Card key={market.instrumentId} market={market} />
      ))}
    </div>
  );
}
