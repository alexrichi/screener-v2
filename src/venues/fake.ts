import { makeInstrument } from './instrument';
import type {
  Instrument,
  VenueAdapter,
  VenueBar,
  VenueTicker,
} from './types';

const BTC_PERP = makeInstrument({
  venue: 'fake',
  nativeId: 'BTCUSDT',
  base: 'BTC',
  quote: 'USDT',
  kind: 'perp',
  velaSymbol: 'FAKE:BTCUSDT.P',
});

const BTC_SPOT = makeInstrument({
  venue: 'fake',
  nativeId: 'BTC/USD',
  base: 'BTC',
  quote: 'USD',
  kind: 'spot',
  velaSymbol: 'FAKE:BTC/USD',
});

const INSTRUMENTS = [BTC_PERP, BTC_SPOT];

function fakeBars(count: number): VenueBar[] {
  const step = 15 * 60_000;
  const start = Math.floor(Date.now() / step) * step - count * step;
  return Array.from({ length: count }, (_, index) => {
    const openTime = start + index * step;
    const close = 50_000 + index;
    return {
      openTime,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 100 + index,
      closeTime: openTime + step - 1,
    };
  });
}

/** A deterministic adapter for tests, offline UI work and adapter conformance. */
export class FakeVenueAdapter implements VenueAdapter {
  readonly id = 'fake';
  readonly label = 'Fake venue';
  readonly capabilities = {
    markets: ['spot', 'perp'] as Array<'spot' | 'perp'>,
    stream: false,
    funding: false,
    trading: false,
  };
  readonly rateLimit = {
    maxConcurrent: 2,
    buckets: [{ id: 'requests', type: 'requests' as const, limit: 20, windowMs: 1000 }],
  };

  async listInstruments(): Promise<Instrument[]> {
    return INSTRUMENTS;
  }

  async fetchTickers(): Promise<VenueTicker[]> {
    return INSTRUMENTS.map((instrument, index) => ({
      instrument,
      last: 50_000 + index,
      change24h: index === 0 ? 1.25 : -0.5,
      quoteVolume: 1_000_000 - index * 100_000,
      funding: null,
      nextFunding: null,
    }));
  }

  async fetchBars(
    _instrument: Instrument,
    _timeframe: string,
    bars: number,
  ): Promise<VenueBar[]> {
    return fakeBars(Math.max(1, bars));
  }
}
