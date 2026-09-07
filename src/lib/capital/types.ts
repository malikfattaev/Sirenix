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
  instrument: {
    epic: string;
    name: string;
    type: string;
    currency: string;
    /**
     * When the market actually trades, as ranges per weekday in the named zone.
     * `marketStatus` keeps saying TRADEABLE outside them, so this is the only
     * honest answer to why a price has stopped moving.
     */
    openingHours?: OpeningHours;
  };
  snapshot: CapitalSnapshot;
}

/** `{ mon: ['00:00 - 17:30'], ..., zone: 'UTC' }` */
export interface OpeningHours {
  mon?: string[];
  tue?: string[];
  wed?: string[];
  thu?: string[];
  fri?: string[];
  sat?: string[];
  sun?: string[];
  zone?: string;
}

/** Flat shape returned by the market search endpoint. */
export interface CapitalMarketSummary {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  marketStatus: string;
  bid: number | null;
  offer: number | null;
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
