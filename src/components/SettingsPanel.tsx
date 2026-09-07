'use client';

import { useState } from 'react';
import {
  DEFAULT_SETTINGS,
  HORIZONS,
  HORIZON_LABEL,
  INSTRUMENTS,
  SETTINGS_LIMITS,
  type Horizon,
  type Settings,
} from '@/lib/config';
import { useMarketData } from './MarketData';

/**
 * What the replay says about each market, in one line, next to the switch that
 * acts on it. A default nobody can see the reason for is a default nobody
 * trusts.
 */
const MEASURED: Record<string, string> = {
  GOLD: 'скальпинг за 31 день около нуля, час в плюс на обеих половинах',
  BRENT: 'скальпинг в минусе при любом пороге, спред 0.70 минутного хода',
};

const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-t border-edge py-4 first:border-t-0 first:pt-0">
      <div className="min-w-0 max-w-md">
        <div className="text-[13px] text-neutral-200">{label}</div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Number_({
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="tabular w-20 rounded-lg border border-edge bg-surface-raised px-3 py-1.5 text-right text-[13px] text-neutral-100 outline-none transition focus:border-neutral-600"
      />
      <span className="text-[12px] text-muted">{suffix}</span>
    </label>
  );
}

export function SettingsPanel() {
  const { settings, applySettings } = useMarketData();
  // Null means "whatever the server says". It only becomes a real object once
  // something is edited, so a poll can never overwrite what is being typed and
  // no effect is needed to keep the two in step.
  const [edited, setEdited] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = edited ?? settings;
  if (!draft || !settings) {
    return <div className="h-64 animate-pulse rounded-xl border border-edge bg-surface" />;
  }

  const dirty = edited !== null && !same(draft, settings);
  const patch = (change: Partial<Settings>) => setEdited({ ...draft, ...change });

  const toggleHorizon = (id: string, horizon: Horizon) => {
    const current = draft.horizons[id] ?? [];
    const next = current.includes(horizon)
      ? current.filter((other) => other !== horizon)
      : [...HORIZONS.filter((other) => current.includes(other) || other === horizon)];
    // A market with nothing to run is just a name on a list.
    if (next.length > 0) patch({ horizons: { ...draft.horizons, [id]: next } });
  };

  const toggleMarket = (id: string) => {
    const next = draft.markets.includes(id)
      ? draft.markets.filter((other) => other !== id)
      : [...draft.markets, id];
    // The board has to have something on it, so the last market cannot be
    // switched off.
    if (next.length > 0) patch({ markets: next });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await applySettings(draft);
      setEdited(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-surface p-5">
        <h2 className="text-[11px] uppercase tracking-wider text-muted">Рынки и горизонты</h2>
        <p className="mt-1 text-[12px] leading-snug text-muted">
          Что анализируется и на каком горизонте. Снятый рынок перестаёт опрашиваться, а его
          открытые сигналы закрываются как неоценённые: судить их больше не по чему. Горизонты
          выключены не по вкусу, а по замерам, они подписаны рядом.
        </p>

        <div className="mt-4 divide-y divide-edge">
          {INSTRUMENTS.map((instrument) => {
            const on = draft.markets.includes(instrument.id);
            const horizons = draft.horizons[instrument.id] ?? [];
            return (
              <div
                key={instrument.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <button
                  type="button"
                  onClick={() => toggleMarket(instrument.id)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition ${
                    on
                      ? 'border-neutral-600 bg-surface-raised text-neutral-100'
                      : 'border-edge text-muted hover:border-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {instrument.label}
                </button>

                <div className="flex flex-wrap items-center gap-1.5">
                  {HORIZONS.map((horizon) => (
                    <button
                      key={horizon}
                      type="button"
                      disabled={!on}
                      onClick={() => toggleHorizon(instrument.id, horizon)}
                      className={`rounded-full border px-3 py-1 text-[11px] transition disabled:opacity-30 ${
                        horizons.includes(horizon)
                          ? 'border-neutral-600 bg-surface-raised text-neutral-100'
                          : 'border-edge text-muted hover:border-neutral-700 hover:text-neutral-300'
                      }`}
                    >
                      {HORIZON_LABEL[horizon]}
                    </button>
                  ))}
                  <span className="text-[11px] text-muted">{MEASURED[instrument.id] ?? ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-surface p-5">
        <h2 className="text-[11px] uppercase tracking-wider text-muted">Как ведёт себя движок</h2>
        <div className="mt-4">
          <Field
            label="Минимальная оценка сигнала"
            hint="Сколько факторов должно совпасть, чтобы сигнал вышел на доску. Выше значение: сигналов меньше, отбор строже."
          >
            <Number_
              value={draft.minScore}
              min={SETTINGS_LIMITS.minScore.min}
              max={SETTINGS_LIMITS.minScore.max}
              suffix={`из 100, по умолчанию ${DEFAULT_SETTINGS.minScore}`}
              onChange={(minScore) => patch({ minScore })}
            />
          </Field>

          {HORIZONS.map((horizon) => (
            <Field
              key={horizon}
              label={`Пауза после убытка: ${HORIZON_LABEL[horizon].toLowerCase()}`}
              hint="Сколько рынок не предлагается заново после убыточной сделки, чтобы выбитый стоп не сменялся входом в ту же пилу."
            >
              <Number_
                value={draft.lossCooldownMinutes[horizon]}
                min={SETTINGS_LIMITS.lossCooldownMinutes.min}
                max={SETTINGS_LIMITS.lossCooldownMinutes.max}
                suffix={`мин, по умолчанию ${DEFAULT_SETTINGS.lossCooldownMinutes[horizon]}`}
                onChange={(value) =>
                  patch({ lossCooldownMinutes: { ...draft.lossCooldownMinutes, [horizon]: value } })
                }
              />
            </Field>
          ))}

          <Field
            label="Записей истории на экране"
            hint="Сколько строк стоит в списке до того, как он начнёт прокручиваться."
          >
            <Number_
              value={draft.historyVisibleRows}
              min={SETTINGS_LIMITS.historyVisibleRows.min}
              max={SETTINGS_LIMITS.historyVisibleRows.max}
              suffix={`строк, по умолчанию ${DEFAULT_SETTINGS.historyVisibleRows}`}
              onChange={(historyVisibleRows) => patch({ historyVisibleRows })}
            />
          </Field>
        </div>
      </div>

      {error && <p className="text-[13px] text-short">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg border border-edge bg-surface-raised px-4 py-1.5 text-[12px] font-medium text-neutral-200 transition hover:border-neutral-600 disabled:opacity-40"
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => setEdited(null)}
            className="rounded-lg border border-edge px-4 py-1.5 text-[12px] text-muted transition hover:text-neutral-300"
          >
            Отменить
          </button>
        )}
        <button
          type="button"
          onClick={() => setEdited(DEFAULT_SETTINGS)}
          className="ml-auto text-[12px] text-muted transition hover:text-neutral-300"
        >
          Вернуть значения по умолчанию
        </button>
      </div>
    </div>
  );
}
