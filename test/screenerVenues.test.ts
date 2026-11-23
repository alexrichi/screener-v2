import { describe, expect, it } from 'vitest';
import { filterRowsForVenues } from '../src/lib/screenerClient';
import type { ScreenerRow } from '../src/types';

function row(venue: string, key: string): ScreenerRow {
  return { instrument: { venue, key } } as unknown as ScreenerRow;
}

const BINANCE = row('binance', 'binance:perp:BTCUSDT');
const OKX = row('okx', 'okx:perp:BTC-USDT-SWAP');
const BYBIT = row('bybit', 'bybit:perp:ETHUSDT');

describe('filterRowsForVenues', () => {
  it('keeps only the selected venues', () => {
    expect(filterRowsForVenues([BINANCE, OKX, BYBIT], ['binance'])).toEqual([BINANCE]);
  });

  it('keeps every venue when the selection is omitted', () => {
    expect(filterRowsForVenues([BINANCE, OKX], undefined)).toEqual([BINANCE, OKX]);
  });

  it('drops every row when no venue is selected', () => {
    expect(filterRowsForVenues([BINANCE, OKX], [])).toEqual([]);
  });

  it('keeps the incoming order', () => {
    expect(filterRowsForVenues([OKX, BINANCE, BYBIT], ['binance', 'bybit'])).toEqual([
      BINANCE,
      BYBIT,
    ]);
  });
});
