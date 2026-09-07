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
      reason: `Всплеск волатильности: ATR на 5м в ${setup.atrRatio.toFixed(1)} раза выше обычного`,
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
      reason: `Цена пробила диапазон в ${priorHeight.toFixed(1)} ATR ${brokeUp ? 'вверх' : 'вниз'}`,
    };
  }

  if (separation >= REGIME.trendSeparationAtr && direction.structure !== 'range') {
    return {
      regime: 'TREND',
      reason: `Тренд: расхождение EMA9/50 на 5м ${separation.toFixed(1)} ATR`,
    };
  }

  if (separation <= REGIME.rangeSeparationAtr && rangeHeight <= REGIME.compressionAtr * 2) {
    return {
      regime: 'RANGE',
      reason: `Диапазон: плоские EMA на 5м внутри полосы в ${rangeHeight.toFixed(1)} ATR`,
    };
  }

  return { regime: 'CHOP', reason: 'Ни тренда, ни чистого диапазона, рынок пилит' };
}
