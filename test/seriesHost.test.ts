import { describe, expect, it } from 'vitest';
import { marketOf } from '../src/lib/pineVela/seriesHost';
import type { Instrument } from '../src/venues/types';

const BTC: Instrument = {
  key: 'binance:perp:BTCUSDT',
  venue: 'binance',
  nativeId: 'BTCUSDT',
  display: 'BTCUSDT.P',
  velaSymbol: 'BINANCE:BTCUSDT.P',
  base: 'BTC',
  quote: 'USDT',
  kind: 'perp',
  pricePrecision: 2,
};

const TICK: Instrument = {
  ...BTC,
  key: 'binance:perp:XYZUSDT',
  nativeId: 'XYZUSDT',
  display: 'XYZUSDT.P',
  velaSymbol: 'BINANCE:XYZUSDT.P',
  base: 'XYZ',
  tickSize: 0.5,
  pricePrecision: 1,
};

describe('marketOf', () => {
  it('mirrors the chart symbol info for a perpetual', () => {
    const market = marketOf(BTC, '15');
    const info = market.symbolInfo as Record<string, unknown>;
    expect(market.symbol).toBe('BINANCE:BTCUSDT.P');
    expect(market.timeframe).toBe('15');
    expect(info.ticker).toBe('BTCUSDT.P');
    expect(info.tickerid).toBe('BINANCE:BTCUSDT.P');
    expect(info.prefix).toBe('BINANCE');
    expect(info.description).toBe('BTC / USDT Perpetual');
    expect(info.type).toBe('futures');
    expect(info.basecurrency).toBe('BTC');
    expect(info.currency).toBe('USDT');
    expect(info.mintick).toBeCloseTo(0.01);
    expect(info.pricescale).toBe(100);
    expect(info.timezone).toBe('Etc/UTC');
    expect(info.session).toBe('24x7');
    expect('root' in info).toBe(false);
  });

  it('uses the tick size for pricescale, not the decimal precision', () => {
    const info = marketOf(TICK, '1').symbolInfo as Record<string, unknown>;
    expect(info.mintick).toBe(0.5);
    expect(info.pricescale).toBe(2);
  });
});
