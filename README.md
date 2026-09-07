# Sirenix

Trading analysis for six markets, built on live Capital.com data.
The app only analyses — it never places an order. Trades are placed by hand on Capital.com.

**GOLD · BRENT OIL · WTI CRUDE · US 30 · US TECH 100 · USD/JPY**

Each market is read on two independent horizons, so every market has two cards:

| Horizon | Holding time | What it looks for |
| --- | --- | --- |
| `SCALPING` | up to 30 minutes | a setup on the 1m/5m/15m ladder, taken as it forms |
| `INTRADAY` | 60 minutes | an hour-scale move already running, joined rather than predicted |

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · SQLite (better-sqlite3) · Capital.com REST API.
Credentials live only on the server, in `.env.local`. Prices refresh every second.

## Setup

```bash
cp .env.example .env.local   # fill in your Capital.com API key, email and API password
npm install
npm run dev
```

## How a scalping signal is produced

```
Market regime  →  15m direction  →  5m setup  →  1m confirmation
      →  spread + volatility check  →  entry / stop / target  →  LONG · SHORT · WAIT
```

* **Timeframes** — 1m entry timing, 5m setup, 15m direction, 1H context veto only.
* **Regime** (`src/lib/strategy/regime.ts`) decides which setups may fire at all. In `CHOP` the
  system stands aside.
* **Strategies** (`src/lib/strategy/strategies/`) — trend pullback, pullback fade, breakout +
  retest, momentum, news momentum, VWAP pullback, S/R bounce, range mean reversion, failed
  breakout, opening range. Each proposes a direction, the level that invalidates it and where the
  setup triggered.
* **Score** (`src/lib/strategy/score.ts`) is the weighted agreement of fourteen components:
  15m direction, 5m trend, 1m confirmation, structure, VWAP, EMA stack, levels, momentum,
  volatility, entry quality, risk/reward, setup quality, 1H context and headline tone. A high
  score means many factors line up — it is **not** a probability of winning.
* **Plan** (`src/lib/strategy/plan.ts`) places the stop just beyond the invalidation level and the
  target at the nearest level price can realistically reach inside a scalp. The real Capital.com
  bid/ask spread must be covered several times over, and an entry more than `maxChaseAtr` past its
  trigger is refused rather than chased.

Every threshold lives in `src/lib/config.ts`, so changing the algorithm and measuring the effect is
a config change plus a backtest run.

## How an intraday signal is produced

`src/lib/intraday/index.ts` measures how far 15-minute price has been pushed, as the average of
three views: the move over the last hour, RSI, and distance from the 20-bar mean. Past a threshold,
and only if the signal bar closed in the same direction, it joins the move with a 2.5 ATR stop and a
2 ATR target, closing at market after an hour.

## News

`src/lib/news/` reads six public RSS feeds and scores each headline against a commodity-specific
vocabulary, so a supply disruption reads as bullish oil and a hawkish central bank as bearish gold.
Recency-weighted, and weighted again by how far into the headline the market is named, so a passing
mention counts for little. The result feeds one component of the score and drives the `news-drive`
strategy, which requires the tape to already agree with the wire.

## Backtest

The same code is replayed bar by bar over historical candles. Nothing visible at bar *t* comes from
after *t*: each timeframe is sliced to candles that had already closed, pivots must be confirmed by
then, and fills pay the spread that was actually quoted. When one candle spans both the stop and the
target, the stop is assumed to have been hit first. Every window is split in half, and a setting has
to work in both.

The `STRATEGY CHECK` panel on the page replays 3, 7 or 14 days.

```bash
npx tsx --env-file=.env.local scripts/backtest.ts 7        # per-strategy results
npx tsx --env-file=.env.local scripts/tradeoff.ts 21       # signal frequency vs win rate
npx tsx --env-file=.env.local scripts/frequency.ts 7       # how often a signal appears
npx tsx --env-file=.env.local scripts/scalpable.ts         # spread relative to 1m ATR, 70+ markets
npx tsx --env-file=.env.local scripts/candidates.ts 14     # the engine on markets not on the board
npx tsx --env-file=.env.local scripts/intradayScan.ts      # the intraday signal across markets
npx tsx --env-file=.env.local scripts/probe.ts             # one live read, printed in full
```

## What the measurements actually say

Reported plainly, because the numbers are the point of the tool.

* **Minute-scale scalping is not profitable** on any of the 12 markets tested over 14 days, at any
  threshold, with any subset of strategies. The cause is measured, not guessed: the round-trip
  spread is a large fraction of a one-minute move — 0.27 ATR on US 30, 0.32 on gold, 0.70 on Brent —
  while the short-term edge found across 47 markets is around 0.04 ATR.
* **The intraday continuation signal is modestly positive.** Of 1,728 configurations tested, six
  were profitable in both halves of an eleven-week sample; all six were continuation and none were
  reversion, and they cluster on the same values. At the chosen settings: 296 trades, 3.9 a day,
  51% win rate, +8.5R, all four months positive, 7 of 12 weeks. Gold carries it; Brent is slightly
  negative. Across 18 markets, gold is the only one positive in both halves.
* **Treat both as a research result, not a promise.** The samples are short and the edge per trade
  is small.

## Signal history

Every signal is recorded in SQLite with the deadline it was issued under, then followed to its
conclusion regardless of whether the strategy behind it still exists.

| Outcome | Meaning |
| --- | --- |
| `OPEN` | still waiting on price |
| `WIN` / `LOSS` | price reached the target or the stop |
| `CLOSED AT TIME` | the holding time ran out; settled at market, with the result in R |
| `NOT EVALUATED` | the market is no longer quoted here, so the signal can never be judged |

## API

| Route | Purpose |
| --- | --- |
| `GET /api/prices` | Live quote per instrument |
| `GET /api/signals` | Current signal per instrument and horizon; records it and settles earlier ones |
| `GET /api/history?limit=20` | Recent signals with their outcome |
| `GET /api/backtest?days=7` | Replay summary, overall and per strategy |
