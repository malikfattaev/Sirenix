# Sirenix

Scalping analysis for **GOLD** and **BRENT OIL** built on live Capital.com market data.
The app only analyses the market — it never places an order. Trades are placed by hand on Capital.com.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · SQLite (better-sqlite3) · Capital.com REST API.
Credentials live only on the server, in `.env.local`.

## Setup

```bash
cp .env.example .env.local   # fill in your Capital.com API key, email and API password
npm install
npm run dev
```

## How a signal is produced

```
Market regime  →  15m direction  →  5m setup  →  1m confirmation
      →  spread + volatility check  →  entry / stop / target  →  LONG · SHORT · WAIT
```

* **Timeframes** — 1m entry timing, 5m setup, 15m direction, 1H context veto only.
* **Regime** (`src/lib/strategy/regime.ts`) decides which setups are allowed to fire at all.
  In `CHOP` the system stands aside.
* **Strategies** (`src/lib/strategy/strategies/`) — trend pullback, breakout + retest, momentum,
  VWAP pullback, S/R bounce, range mean reversion, failed breakout, opening range.
  Each proposes a direction, the level that invalidates it and where the setup triggered.
* **Score** (`src/lib/strategy/score.ts`) is the weighted agreement of 15m direction, 5m trend,
  1m confirmation, structure, VWAP, EMA stack, levels, momentum, volatility, entry quality and
  risk/reward. A high score means many factors line up — it is **not** a probability of winning.
* **Plan** (`src/lib/strategy/plan.ts`) places the stop just beyond the invalidation level and the
  target at the nearest level price can realistically reach inside a scalp. The real Capital.com
  bid/ask spread must be covered several times over, and an entry more than
  `maxChaseAtr` past its trigger is refused rather than chased.

Every threshold lives in `src/lib/config.ts` (`DEFAULT_TUNING`), so changing the algorithm and
measuring the effect is a config change plus a backtest run.

## Backtest

The same code is replayed bar by bar over historical candles. Nothing visible at bar *t* comes
from after *t*: each timeframe is sliced to candles that had already closed, swing detection only
uses pivots confirmed by then, and fills pay the spread that was actually quoted. When one candle
spans both the stop and the target, the stop is assumed to have been hit first.

```bash
npx tsx --env-file=.env.local scripts/backtest.ts 6      # per-strategy results
npx tsx --env-file=.env.local scripts/sweep.ts 6 minScore=62,70   # compare settings
npx tsx --env-file=.env.local scripts/regimes.ts 6       # regime distribution
npx tsx --env-file=.env.local scripts/probe.ts           # one live read, printed in full
```

The `STRATEGY CHECK` panel on the page runs the same thing for 2, 5 or 10 days.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/signals` | Current signal per instrument; records it and settles earlier ones |
| `GET /api/history?limit=20` | Recent signals with their outcome |
| `GET /api/backtest?days=5` | Replay summary, overall and per strategy |
