import type { MarketRow } from '../types';
import { SidecarVenueAdapter } from '../venues/sidecar';
import type { VenueTicker } from '../venues/types';

const sidecar = new SidecarVenueAdapter('binance');

function toMarketRows(tickers: VenueTicker[]): MarketRow[] {
  return tickers
    .map((ticker) => ({
      symbol: ticker.instrument.nativeId,
      base: ticker.instrument.base,
      quote: ticker.instrument.quote,
      price: ticker.last,
      change24h: ticker.change24h,
      quoteVolume: ticker.quoteVolume,
      funding: ticker.funding,
      nextFunding: ticker.nextFunding,
      pricePrecision: ticker.instrument.pricePrecision,
    }))
    .sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
}

/** Market rows come from the sidecar only — no direct exchange path. */
export async function fetchMarketRows(signal?: AbortSignal): Promise<MarketRow[]> {
  return toMarketRows(await sidecar.fetchTickers(signal));
}
