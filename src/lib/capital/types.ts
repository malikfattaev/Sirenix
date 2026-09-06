/** Raw payload shapes returned by the Capital.com REST API. */

export interface CapitalPricePoint {
  bid: number;
  ask: number;
}

export interface CapitalPrice {
  /** Candle open time in the account timezone. */
  snapshotTime: string;
  /** Candle open time in UTC, without a timezone suffix. */
  snapshotTimeUTC: string;
  openPrice: CapitalPricePoint;
  closePrice: CapitalPricePoint;
  highPrice: CapitalPricePoint;
  lowPrice: CapitalPricePoint;
  lastTradedVolume: number;
}

export interface CapitalPricesResponse {
  prices: CapitalPrice[];
  instrumentType: string;
}

export interface CapitalSnapshot {
  marketStatus: string;
  netChange: number;
  percentageChange: number;
  updateTime: string;
  delayTime: number;
  bid: number | null;
  offer: number | null;
  high: number;
  low: number;
  decimalPlacesFactor: number;
  scalingFactor: number;
}

export interface CapitalMarketDetails {
  instrument: { epic: string; name: string; type: string; currency: string };
  snapshot: CapitalSnapshot;
}

export interface CapitalMarketsResponse {
  marketDetails: CapitalMarketDetails[];
}

export interface CapitalErrorBody {
  errorCode?: string;
}

export class CapitalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'CapitalApiError';
  }
}
