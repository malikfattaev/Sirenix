# Intraday check, 2026-09-08

Run: `npx tsx scripts/research/intradayCompare.ts`.

Cached Capital.com 15m candles: GOLD, June 23 to September 7 (4,998 bars);
BRENT, June 19 to September 7 (4,999 bars). Each market is evaluated separately.
The first 300 bars warm up the production indicators.

The replay calls the production intraday analysis, buys at ask and sells at bid.
It uses the opposite side to exit, assumes the stop first if both levels are
touched, and includes adverse opening gaps through stops. Spread at candle close
approximates spread throughout that candle; ticks and execution slippage are not
available. Entries whose holding window crosses missing bars/session gaps are
excluded. This uses fixed default cooldowns, not the user's saved live settings.
It is a closed-bar research approximation, not an exact live replay.

Nine variants per market: strength thresholds 1.4, 1.8, 2.2 crossed with targets
1.5, 2.0, 2.5 ATR. Stop stays 2.5 ATR and lifetime stays 60 minutes. Periods are
split by calendar time, with trades crossing the split excluded from half-period
statistics. This history has already been explored by earlier research, so the
second half is not a fresh unseen validation set.

| Market | Threshold | Target ATR | Trades | Signals/calendar day | First R | Second R | Total R | Max drawdown R |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GOLD baseline | 1.8 | 2.0 | 134 | 1.83 | 7.82 | -4.87 | 2.95 | 8.40 |
| GOLD lower threshold | 1.4 | 2.0 | 210 | 2.87 | -3.63 | -5.77 | -9.40 | 10.31 |
| GOLD best first-period total | 1.8 | 2.5 | 124 | 1.69 | 10.76 | -2.02 | 8.74 | 7.19 |
| BRENT baseline | 1.8 | 2.0 | 143 | 1.91 | -3.67 | 1.37 | -2.31 | 7.93 |
| BRENT lower threshold | 1.4 | 2.0 | 179 | 2.39 | -13.50 | -8.17 | -21.68 | 23.70 |
| BRENT best first-period total | 2.2 | 1.5 | 96 | 1.28 | -1.37 | -1.55 | -2.91 | 4.62 |

R is profit/loss divided by the initial entry-to-stop distance, not currency.
None of the nine variants on either market was positive in both periods. Keep
the current values in both independently configurable market profiles; these
measurements do not justify promoting different values or lowering thresholds.

The new rejection journal starts collecting on future analysis requests. Its
counts are rejected minute snapshots, not independent missed trades. A snapshot
stores reasons, bid/ask/spread and any fully formed rejected plan. Filters that
reject before a plan exists have no hypothetical trade outcome. No filter's
usefulness has yet been established from this new journal.
