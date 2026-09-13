# Sirenix

Trading analysis for gold and Brent, built on live Capital.com data.
The app only analyses — it never places an order. Trades are placed by hand on Capital.com.

**GOLD · BRENT OIL**

Each market is read on two independent horizons. Which horizons run on which market is not a
preference but a measurement, and the numbers are in **What the measurements actually say**:

| Horizon | Holding time | What it looks for |
| --- | --- | --- |
| `SCALPING` | up to 30 minutes | a setup on the 1m/5m/15m ladder, taken as it forms |
| `INTRADAY` | 60 minutes | an hour-scale move already running, joined rather than predicted |

## Modules

A sidebar over four pages, all reading one set of polling loops (`src/components/MarketData.tsx`)
so moving between them never restarts the analysis or drops the quote stream.

| Section | Module | What it is |
| --- | --- | --- |
| Итог | `/` Панель управления | Signals issued, how many ended in profit, how many are running, with the record underneath |
| Рынок | `/signals` Сигналы | The live cards, two per market |
| Рынок | `/news` Новости | The headline reading per market, with the stories behind it |
| Система | `/settings` Настройки | Which markets are on the board, how selective the engine is, and the backtest |
| Система | `/access` Доступ | Accounts and roles. Administrators only |

## Access

Everything is behind a login. Two roles: `admin` sees every module, `user` sees every module except
`Доступ` — and not merely hidden: the page answers 404 and `/api/access` answers 403, so the address
tells an ordinary user nothing about what is there. Every other API route requires a session too,
because a page that refuses to render is not what makes data safe; the route that serves it is.

* Passwords are stored as `salt:key` from scrypt, never reversibly, and compared in constant time.
* A wrong login and a wrong password give the same message and cost the same time, so the form
  cannot be used to enumerate accounts.
* A session is a random token in an `httpOnly` cookie; only its SHA-256 is stored, so a copy of the
  database hands nobody a way in. Deleting an account or changing a password drops its sessions.
* The last administrator cannot be deleted or demoted, and nobody can delete themselves.
* **The first administrator comes from `ADMIN_LOGIN` and `ADMIN_PASSWORD`**, created once when the
  user table is empty. Deliberately not a setup page: an install that hands the first visitor an
  admin account is one open port away from being someone else's.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · SQLite (better-sqlite3) · Capital.com REST API.
Credentials live only on the server, in `.env.local`. Prices refresh every second.

## Setup

```bash
cp .env.example .env.local   # fill in your Capital.com API key, email and API password
npm install
npm run dev
```

`npm test` runs the entry, exit-side and journal checks; `npm run typecheck` and
`npm run lint` cover the rest. Deployment is described in
[docs/deploy-railway.md](docs/deploy-railway.md).

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
a config change plus a backtest run. The few a person is expected to change while it runs are in
the settings module and stored in `data/settings.json`; everything else is a measured value that
would invalidate the backtest it came from, so it stays in the file and in git.

## Where the price comes from

The REST snapshot at `/markets` is not a quote stream: it is whatever the server last wrote down.
Measured on this account in one 30-second window, gold and WTI came back current while **Brent was
32 minutes behind** and the two indices two to three minutes behind, every one of them still
reporting `TRADEABLE`, with nothing in the response to say so.

So prices come from the streaming socket (`src/lib/market/stream.ts`), the same feed the platform
draws, and the snapshot is left to supply what does not tick: quoting precision, market status and
the day's change. On top of that:

* **The card shows the two prices the platform shows**, sell and buy, named the way it names them.
  The middle of the spread is what the chart and every level are drawn on, but it is a price nobody
  trades at, and showing it large is what made this board look like it disagreed with Capital.com.
* **A closed market is said to be closed.** `marketStatus` is not the answer: Brent spot reported
  `TRADEABLE` for half an hour after its Monday session ended at 17:30 UTC, with a price that had
  not moved since. The instrument's own `openingHours` is what tells a sleeping market apart from a
  broken feed (`src/lib/market/hours.ts`), and the card says which it is.
* **A price that has stopped moving while its session is running is labelled and taken out of play.** Staleness is measured
  locally, as the time since a bid or ask last differed, so it needs no faith in the server's clock
  or timezone. Past `QUOTE_STALE_MS` the card says how long the price has stood still and the engine
  issues nothing on that market; a signal already running still shows so it can be managed.
* **Nothing waits forever.** Every request to Capital.com and every request from the page carries a
  deadline, and the polling loop schedules its next round in a `finally`. A single hung socket used
  to end the loop outright, leaving the last prices on screen looking current.

## Which side of the book

Candles are mid prices, but a trade lives on one side of the spread, and on these markets the
spread is a large fraction of a one-minute move. So:

* the published entry is the price actually paid, ask for a long and bid for a short, which makes
  the risk larger and the reward smaller than the chart suggests;
* a stop or target is judged on the side that closes the position: a long is stopped when the
  **bid** reaches the level, half a spread below the mid it is drawn at. Judging it on the mid is
  how a stop already taken keeps reading as untouched;
* the live quote settles a signal the moment a level is taken, rather than waiting for the minute
  candle to close and be published, which used to leave a dead trade on the board for a minute.

The backtest and the live engine use the same convention, so the replay describes the system that
is actually running.

## How an intraday signal is produced

Entry uses the live ask for LONG and bid for SHORT; missing/invalid bid and ask
block a new signal. Stop and target are anchored to that fill. Market-specific
parameters live in `INTRADAY_BY_MARKET` in `src/lib/config.ts`; GOLD and BRENT
currently keep the same baseline after the [separate-market check](docs/intraday-check-2026-09-08.md).
The common holding time stays 60 minutes.

`src/lib/intraday/index.ts` measures how far 15-minute price has been pushed, as the average of
three views: the move over the last hour, RSI, and distance from the 20-bar mean. Past a threshold,
and only if the signal bar closed in the same direction, it joins the move with a 2.5 ATR stop and a
2 ATR target, closing at market after an hour.

## News

`src/lib/news/` reads the public RSS feeds and scores each headline against a commodity-specific
vocabulary, so a supply disruption reads as bullish oil and a hawkish central bank as bearish gold.
Recency-weighted, and weighted again by how far into the headline the market is named, so a passing
mention counts for little. The result feeds one component of the score and drives the `news-drive`
strategy, which requires the tape to already agree with the wire. It is read in the `Новости`
module; the signal cards stay on the trade.

## One direction at a time

The engine ranks every setup from scratch on every poll. That is right for finding a trade and
wrong for keeping one: a market drifting around a single level hands the top slot to a fade one
minute and to a breakout the next, and following that means closing a losing trade early and paying
the spread again to enter the opposite one. So a market carries one signal per horizon at a time
(`src/lib/position.ts`):

* while a signal is open, the board keeps showing **that** signal, on its original entry, stop and
  target. No other setup on that market is issued, in either direction.
* it ends only where it was always going to end: its stop, its target, or its holding time.
* after a losing close the market is left alone for `POSITION.lossCooldownMs` before it is offered
  again, so a stop-out is not immediately followed by a reverse entry into the same chop;
* after `POSITION.maxLossStreak` losses in a row it comes off the board entirely, for four hours on
  the minute scale and twelve on the hour scale. A run of six at a 50% win rate turns up about once
  in sixty-four attempts and cannot be designed away, but it does not have to be sat through: three
  in a row is either the market having changed character or the read being wrong about it, and
  neither is fixed by taking the fourth trade. Both numbers are on the settings page.

## Backtest

The same code is replayed bar by bar over historical candles. Nothing visible at bar *t* comes from
after *t*: each timeframe is sliced to candles that had already closed, pivots must be confirmed by
then, and fills pay the spread that was actually quoted. When one candle spans both the stop and the
target, the stop is assumed to have been hit first. Every window is split in half, and a setting has
to work in both.

The `STRATEGY CHECK` panel on the page replays 3, 7 or 14 days.

```bash
npm run backtest 7                                   # per-strategy results
npm run probe                                        # one live read, printed in full
npx tsx scripts/research/tradeoff.ts 21              # signal frequency vs win rate
npx tsx scripts/research/frequency.ts 7              # how often a signal appears
npx tsx scripts/research/scalpable.ts                # spread relative to 1m ATR, 70+ markets
npx tsx scripts/research/candidates.ts 14            # the engine on markets not on the board
npx tsx scripts/research/intradayScan.ts             # the intraday signal across markets
```

The `npx tsx` lines read no environment file of their own; prefix them with
`--env-file-if-exists=.env.local` when the credentials are not already exported.

## What the measurements actually say

The tables below are earlier research results, not a validation of the current
live implementation. The [September 8 separate-market check](docs/intraday-check-2026-09-08.md)
uses production intraday entries and exit-side candle checks; none of its tested
variants was positive in both periods on either market. Older research scripts
may use different fill, exit and cooldown assumptions.

**Minute-scale scalping does not work on Brent, and is a coin toss on gold.** Over 31 days of
one-minute candles:

| minScore | GOLD | BRENT |
| --- | --- | --- |
| 58 | 58 trades, 44.8% win, **+1.0R** | 60 trades, 23.3% win, **−23.4R** |
| 62 | 44 trades, 43.2% win, +0.7R | 50 trades, 28.0% win, −14.4R |
| 66 | 28 trades, 35.7% win, −4.7R | 40 trades, 25.0% win, −15.9R |
| 70 | 14 trades, 21.4% win, −7.2R | 23 trades, 30.4% win, −5.6R |

Raising the bar does not rescue it; it just trades less while still losing. Run strategy by strategy
on both halves (`scripts/research/lab.ts`), **not one setup is positive in both halves on either market**.
The cause is the spread: a Brent round trip costs 0.70 of a one-minute move, the worst of the 72
markets screened, against a short-term edge measured at around 0.04 ATR.

**The hour scale is the part that survives.** Of 1,728 configurations tested at 15-minute
resolution over 77 days on both markets pooled, **6 were profitable in both halves**; all six are
continuation, none are reversion, and they cluster on the same values. The one running here:

| | trades | win | result |
| --- | --- | --- | --- |
| first half | 148 | 51% | **+3.8R** |
| second half | 148 | 49% | **+4.4R** |

3.9 signals a day across the two markets, about two per market, which is what makes this the
horizon the board leads with. Both markets run both horizons; the settings module can turn either
off per market, and says next to each switch what the replay found, so the numbers above are in
front of the choice rather than behind it.

**Read it as a research result, not a promise.** Eleven weeks is a short sample, half a point of
win rate either way changes the sign, and the edge per trade is small.

**The score is not a probability.** A signal scoring 74 is 74 points of agreement between fourteen
factors, not a 74% chance. Signals in the replay average a score near 69 and win between 20% and 59%
of the time depending on the market and the horizon.

## Signal history

Rejected readings are stored separately in SQLite `signal_skips`. The first WAIT
snapshot per market, horizon, reason code and minute is retained, so browser poll
frequency does not multiply the count. These are minute samples, not unique
missed trading opportunities. Snapshots include quotes, reasons and rejected
plans when available (score and cooldown rejections). They do not count as trades
or affect signal statistics. Collection happens on analysis requests, not while
the application is idle with no polling clients.

Inspect: `npm run skips`, or authenticated `GET /api/skips?limit=50`
(latest snapshots and a 24-hour summary, maximum limit 100).

Verify the entry, exit-side and journal behavior:
`npm test`.

Every signal is recorded in SQLite with the deadline it was issued under, then followed to its
conclusion. A signal issued on terms that no longer exist here, because its market or its horizon
has been retired, is dropped from the record rather than shown as a forecast nobody is going to
judge.

| Outcome | Meaning |
| --- | --- |
| `OPEN` | still waiting on price |
| `WIN` / `LOSS` | price reached the target or the stop |
| `CLOSED AT TIME` | the holding time ran out; settled at market, with the result in R |
| `REVERSED` | legacy: the engine used to be allowed to turn around mid-trade, and closed the old signal at market |

## API

| Route | Purpose |
| --- | --- |
| `GET /api/prices` | Live quote per instrument |
| `GET /api/signals` | Current signal per instrument and horizon; records it and settles earlier ones |
| `GET /api/history?limit=50` | Recent signals with their outcome |
| `DELETE /api/history` | Wipes the settled history; signals still running are kept |
| `GET /api/backtest?days=7` | Replay summary, overall and per strategy |
| `GET /api/stats` | Signals issued, profitable and open |
| `GET /api/news` | Headline reading for every market on the board |
| `GET /api/settings`, `PUT /api/settings` | What the settings module reads and writes |
| `POST /api/auth/login`, `POST /api/auth/logout` | Sign in and out |
| `/api/access` | Accounts: GET, POST, PATCH, DELETE. Administrators only |
