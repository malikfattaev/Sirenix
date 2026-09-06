import { REGIME, type Regime } from '@/lib/config';
import { rangeOf } from '@/lib/indicators';
import type { Views } from './types';

export interface RegimeRead {
  regime: Regime;
  reason: string;
}

/**
 * Classifies what the market is doing right now, because the same setup means
 * different things in a trend and in a range. Everything is measured in ATR
 * multiples so the thresholds hold for both gold and oil.
 */
export function detectRegime(views: Views): RegimeRead {
  const { setup, direction } = views;
  const { high, low } = rangeOf(setup.candles, REGIME.rangeLookback);
  const rangeHeight = (high - low) / setup.atr;
  const separation = setup.ema50 === null ? 0 : Math.abs(setup.ema9 - setup.ema50) / setup.atr;
  const lastClose = setup.close;

  if (setup.atrRatio >= REGIME.extremeAtrRatio) {
    return {
      regime: 'EXTREME_VOLATILITY',
      reason: `Volatility spike — 5m ATR is ${setup.atrRatio.toFixed(1)}x its normal level`,
    };
  }

  // A breakout is a compressed range that price has just left with conviction.
  const priorRange = rangeOf(setup.candles.slice(0, -2), REGIME.rangeLookback);
  const priorHeight = (priorRange.high - priorRange.low) / setup.atr;
  const brokeUp = lastClose > priorRange.high;
  const brokeDown = lastClose < priorRange.low;
  if ((brokeUp || brokeDown) && priorHeight <= REGIME.compressionAtr * 1.6 && setup.atrRatio > 1) {
    return {
      regime: 'BREAKOUT',
      reason: `Price broke ${brokeUp ? 'above' : 'below'} a ${priorHeight.toFixed(1)} ATR range`,
    };
  }

  if (separation >= REGIME.trendSeparationAtr && direction.structure !== 'range') {
    return {
      regime: 'TREND',
      reason: `Trending — 5m EMA9/50 spread ${separation.toFixed(1)} ATR, 15m structure ${direction.structure}`,
    };
  }

  if (separation <= REGIME.rangeSeparationAtr && rangeHeight <= REGIME.compressionAtr * 2) {
    return {
      regime: 'RANGE',
      reason: `Ranging — flat 5m EMAs inside a ${rangeHeight.toFixed(1)} ATR band`,
    };
  }

  return { regime: 'CHOP', reason: 'No clean trend or range — conditions are choppy' };
}
