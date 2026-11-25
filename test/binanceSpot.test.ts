import { describe, expect, it } from 'vitest';
import { chartSymbol, spotSymbol } from '../src/lib/binance';
import { sameVelaSymbol } from '../src/venues/instrument';
import { BinanceSpotVenueAdapter } from '../src/venues/binanceSpot';
import {
  DEFAULT_MIN_VOLUME_BY_VENUE,
  DEFAULT_SCREENER_VENUES,
  defaultMinVolume,
  VENUE_IDS,
} from '../src/venues/catalog';

describe('Binance spot venue', () => {
  it('is a separate venue with its own rate budget', () => {
    const adapter = new BinanceSpotVenueAdapter();
    expect(adapter.id).toBe('binance_spot');
    expect(adapter.label).toBe('Binance Spot');
    expect(adapter.capabilities.markets).toEqual(['spot']);
    expect(adapter.capabilities.funding).toBe(false);
    expect(adapter.rateLimit.buckets[0]?.limit).toBe(6000);
  });

  it('is off in the default screener venue list', () => {
    expect(DEFAULT_SCREENER_VENUES).toEqual(
      VENUE_IDS.filter((venue) => venue !== 'binance_spot'),
    );
  });
});

describe('chart symbols', () => {
  it('adds .P to a bare ticker and keeps a prefixed one as it is', () => {
    expect(chartSymbol('BTCUSDT')).toBe('BTCUSDT.P');
    expect(chartSymbol('BTCUSDT.P')).toBe('BTCUSDT.P');
    expect(chartSymbol('BINANCE:BTCUSDT.P')).toBe('BINANCE:BTCUSDT.P');
    expect(chartSymbol('BINANCE.SPOT:BTCUSDT')).toBe('BINANCE.SPOT:BTCUSDT');
    expect(spotSymbol('BTCUSDT.P')).toBe('BTCUSDT');
    expect(spotSymbol('BINANCE:BTCUSDT.P')).toBe('BINANCE:BTCUSDT.P');
  });

  it('keeps spot and perp apart', () => {
    expect(sameVelaSymbol('BINANCE.SPOT:BTCUSDT', 'BINANCE.SPOT:BTCUSDT')).toBe(true);
    expect(sameVelaSymbol('BINANCE.SPOT:BTCUSDT', 'BINANCE:BTCUSDT.P')).toBe(false);
    expect(sameVelaSymbol('BTCUSDT', 'BINANCE:BTCUSDT.P')).toBe(true);
  });
});

describe('per-venue watch thresholds', () => {
  it('gives every venue its own default', () => {
    expect(Object.keys(DEFAULT_MIN_VOLUME_BY_VENUE).sort()).toEqual([...VENUE_IDS].sort());
    for (const venue of VENUE_IDS) expect(defaultMinVolume(venue)).toBe(1_000_000);
  });
});
