# What predicts one to two hours

A search for a tradable edge under one hard constraint: a position is held for
at most two hours. Ten markets at most, gold and Brent among them.

Five studies, 50 markets, 5000 hourly candles each, ~122,000 non-overlapping
observations. Every figure is net of the round trip and net of the market's own
drift, because gold went from 3400 to 4300 across this sample and any rule that
happens to buy is paid by that alone.

## The answer

**Nothing tested pays at one or two hours.** The reason is not that the signals
are absent — it is that they are about four times too small to cover the spread
at this horizon.

| Held | Predictive signal | Cost of the round trip |
| --- | --- | --- |
| 1h | 0.009 ATR | 0.129 ATR |
| 2h | 0.034 ATR | 0.132 ATR |
| 4h | 0.053 ATR | 0.138 ATR |
| 8h | 0.061 ATR | 0.129 ATR |
| 12h | 0.124 ATR | 0.135 ATR |
| 24h | 0.133 ATR | 0.131 ATR |

The cost does not move, because a spread is a spread however long the position
is held. The signal grows roughly with the square root of time, because that is
how far prices travel. The two lines cross somewhere between **twelve and
twenty-four hours**, and the two-hour budget sits well to the left of it.

That single table explains every other negative result in this repository: the
minute engine, the quarter-hour engine and the exit studies are all being asked
to pay a fixed toll out of a move that has not had time to grow.

## What was measured

### 1. Twelve price features, one to two hours ahead

`scripts/research/shortHorizon.ts`. Returns over 1/2/4/6/24 hours, RSI, distance
from EMA20, range position, ATR ratio, candle body, wick balance and a
reversal term — each in ATR units so markets pool, each measured on the extreme
decile, split into halves, drift removed.

Pooled across 50 markets: not one feature-and-side pays in both halves at either
horizon. Per market, gold produced four apparent survivors and they dissolve on
inspection:

| Candidate | mean | median | hit | t |
| --- | --- | --- | --- | --- |
| GOLD, return 2h, long | +0.1302 | +0.0159 | 51% | 1.99 |
| GOLD, atr ratio low, long | +0.0767 | +0.0191 | 51% | 1.05 |
| INDICES, atr ratio high, long | +0.0258 | −0.0061 | 50% | 1.62 |

A mean of +0.13 with a median of +0.016 and a hit rate of 51% is a handful of
large moves carrying an average, not an edge. With roughly a hundred tests run,
a t near two is expected several times by chance.

### 2. Cross-sectional ranking

`scripts/research/crossSection.ts`. At each hour the board is ranked by its
recent move; the laggards are bought and the leaders sold, and the reverse.
Whatever moves every market together cancels between the legs, so this cannot be
fooled by drift the way a time-series test can.

Both directions lose at one and two hours, on 2477 baskets, in both halves, with
t between −4.6 and −8.1 and hit rates of 40–45%. The raw ranking does carry
information — leaders beat laggards by about 0.034 ATR over two hours — and it
costs 0.132 ATR to collect.

### 3. Hour of day

`scripts/research/seasonality.ts`. No hour on either market reaches a t of 2, and
the two halves disagree on every hour that looks promising. Gold at 23:00 is the
strongest reading in the whole table at t = 1.64, and its second half is +0.009%.

### 4. Mean reversion at 5 to 60 minutes

`scripts/research/reversion.ts`. Net of spread, the extreme deciles lose across
every asset class at every horizon: indices −0.17 to −0.40, commodities −0.55 to
−0.71, currencies −0.66 to −0.81. The spread is 46% of a five-minute move on
indices and 79% on currencies.

### 5. The live engine

`npm run backtest`, `scripts/research/exits.ts`, `scripts/research/sweep.ts`.
Nine exit policies from −8.5R to −16.7R; nine threshold-and-hold combinations
from −5.4R to −20.0R. No configuration is positive.

## What the cost actually is

Spread divided by one-minute ATR, measured live across 72 markets. The ten
cheapest that include gold and Brent:

| Market | Cost | | Market | Cost |
| --- | --- | --- | --- | --- |
| US30 | 0.34 | | DE40 | 0.59 |
| US100 | 0.39 | | OIL_CRUDE | 0.59 |
| US500 | 0.43 | | OIL_BRENT | 0.64 |
| NL25 | 0.47 | | FR40 | 0.75 |
| GOLD | 0.56 | | J225 | 0.98 |

Currencies are the worst of everything at 1.3–1.6 and should not be on a board
at any horizon shorter than a day.

If the board has to be ten markets, these are the ten. That choice is worth
making whatever else is decided, because it is the only lever that moves the
cost line rather than the signal line — and even moving it as far as US30's 0.34
does not bring break-even inside two hours.

## What was not tested

**News.** The only genuinely untested angle, and the one most likely to produce
a move large enough to clear the spread inside two hours. It cannot be
backtested here: the RSS feeds the app reads reach back a few hours, so there is
no history to measure against. Any news rule would have to be run forward,
recording its own results, for months before it could be judged.

**Order flow and depth.** Not available from this data feed at all.

## What follows from this

1. **Twelve hours, not two.** The shortest hold at which the measured signal
   clears the measured cost. If the account can carry a position overnight, the
   research to do is on that horizon, and the index reversion effect already in
   this repository — 1163 trades, +121.8R, +62.7R and +59.2R in the two halves —
   is the place to start.
2. **If two hours is fixed, the honest position is that no edge has been found.**
   Not "not yet tuned" — five independent studies, three resolutions and
   a hundred-odd tests all land on the same explanation, and the explanation is
   arithmetic rather than a parameter.
3. **Trading the current signals with real money is not supported by anything
   measured here.** Leverage multiplies a negative expectancy exactly as
   faithfully as a positive one.
