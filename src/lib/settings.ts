import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TUNING,
  HORIZONS,
  INSTRUMENTS,
  SETTINGS_LIMITS,
  type Horizon,
  type InstrumentConfig,
  type Settings,
  type StrategyTuning,
} from '@/lib/config';

const FILE = process.env.SETTINGS_PATH ?? path.join(process.cwd(), 'data', 'settings.json');

let cache: Settings | null = null;

const clamp = (value: number, { min, max }: { min: number; max: number }, fallback: number) =>
  Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;

/**
 * Merges what is on disk onto the defaults, field by field.
 *
 * A stored file is not trusted to be complete or current: it was written by an
 * older build, or edited by hand. Anything missing or out of range falls back
 * to the compiled default rather than taking the engine somewhere it was never
 * measured.
 */
function normalise(stored: Partial<Settings> | null): Settings {
  const configured = new Set(INSTRUMENTS.map((instrument) => instrument.id));
  const markets = (stored?.markets ?? []).filter((id) => configured.has(id));

  return {
    markets: markets.length > 0 ? markets : DEFAULT_SETTINGS.markets,
    minScore: clamp(
      stored?.minScore ?? DEFAULT_SETTINGS.minScore,
      SETTINGS_LIMITS.minScore,
      DEFAULT_SETTINGS.minScore,
    ),
    lossCooldownMinutes: {
      scalp: clamp(
        stored?.lossCooldownMinutes?.scalp ?? DEFAULT_SETTINGS.lossCooldownMinutes.scalp,
        SETTINGS_LIMITS.lossCooldownMinutes,
        DEFAULT_SETTINGS.lossCooldownMinutes.scalp,
      ),
      intraday: clamp(
        stored?.lossCooldownMinutes?.intraday ?? DEFAULT_SETTINGS.lossCooldownMinutes.intraday,
        SETTINGS_LIMITS.lossCooldownMinutes,
        DEFAULT_SETTINGS.lossCooldownMinutes.intraday,
      ),
    },
    historyVisibleRows: clamp(
      stored?.historyVisibleRows ?? DEFAULT_SETTINGS.historyVisibleRows,
      SETTINGS_LIMITS.historyVisibleRows,
      DEFAULT_SETTINGS.historyVisibleRows,
    ),
    maxLossStreak: clamp(
      stored?.maxLossStreak ?? DEFAULT_SETTINGS.maxLossStreak,
      SETTINGS_LIMITS.maxLossStreak,
      DEFAULT_SETTINGS.maxLossStreak,
    ),
    // A market with no horizon left on would sit on the board doing nothing,
    // so an empty choice falls back to what the config measured for it.
    horizons: Object.fromEntries(
      INSTRUMENTS.map((instrument) => {
        const chosen = (stored?.horizons?.[instrument.id] ?? []).filter((horizon) =>
          HORIZONS.includes(horizon),
        );
        return [
          instrument.id,
          chosen.length > 0 ? chosen : DEFAULT_SETTINGS.horizons[instrument.id],
        ];
      }),
    ),
  };
}

/** Current settings. Read from disk once, then held in memory. */
export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = normalise(JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Settings>);
  } catch {
    // No file yet, or an unreadable one: the defaults are a valid answer.
    cache = normalise(null);
  }
  return cache;
}

/** Writes settings and returns what was actually stored after clamping. */
export function saveSettings(patch: Partial<Settings>): Settings {
  const next = normalise({ ...getSettings(), ...patch });
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  cache = next;
  return next;
}

/** The markets currently on the board, in the order `config.ts` lists them. */
export function activeInstruments(): InstrumentConfig[] {
  const { markets } = getSettings();
  return INSTRUMENTS.filter((instrument) => markets.includes(instrument.id));
}

/** The strategy tuning with the one field the settings page owns applied. */
export function activeTuning(): StrategyTuning {
  return { ...DEFAULT_TUNING, minScore: getSettings().minScore };
}

/** The horizons to run on one market, after settings. */
export function horizonsFor(instrumentId: string): Horizon[] {
  return getSettings().horizons[instrumentId] ?? HORIZONS;
}

/** Losses in a row that take a market off the board. */
export function maxLossStreak(): number {
  return getSettings().maxLossStreak;
}

/** Milliseconds a market is left alone after a losing trade. */
export function lossCooldownMs(horizon: Horizon): number {
  return getSettings().lossCooldownMinutes[horizon] * 60_000;
}
