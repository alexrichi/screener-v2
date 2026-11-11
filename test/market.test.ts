import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseFromSymbol,
  binanceInterval,
  chartSymbol,
  spotSymbol,
  symbolLabel,
} from '../src/lib/binance';
import {
  formatCompact,
  formatFunding,
  formatPct,
  formatPrice,
  layoutLabel,
} from '../src/lib/format';
import {
  DEFAULT_VIEW,
  isScreenerView,
  mergeColumnOrder,
  nextSort,
} from '../src/lib/view';
import { isStringArray } from '../src/lib/usePersistedState';
import {
  favoriteKey,
  scanTargetsFor,
  trimRowsPerVenue,
} from '../src/lib/universe';
import { fetchMarketRows } from '../src/lib/marketData';
import type { MarketRow, VenueId } from '../src/types';
import { SidecarVenueAdapter } from '../src/venues/sidecar';
import { makeInstrument } from '../src/venues/instrument';

function row(venue: VenueId, nativeId: string, quoteVolume: number): MarketRow {
  const kind = venue === 'coinbase' ? 'spot' : 'perp';
  const instrument = makeInstrument({
    venue,
    kind,
    nativeId,
    base: 'BTC',
    quote: 'USDT',
    velaSymbol: `${venue.toUpperCase()}:${nativeId}`,
  });
  return {
    instrument,
    price: 1,
    change24h: 1,
    quoteVolume,
    funding: null,
    nextFunding: null,
  };
}

describe('binance symbols and intervals', () => {
  it('maps Vela futures symbols both ways', () => {
    expect(chartSymbol('BTCUSDT')).toBe('BTCUSDT.P');
    expect(chartSymbol('BTCUSDT.P')).toBe('BTCUSDT.P');
    expect(chartSymbol('binance:BTCUSDT')).toBe('binance:BTCUSDT.P');
    expect(chartSymbol('OKX:BTC-USDT-SWAP')).toBe('OKX:BTC-USDT-SWAP');
    expect(spotSymbol('BTCUSDT.P')).toBe('BTCUSDT');
    expect(spotSymbol('BINANCE:BTCUSDT.P')).toBe('BINANCE:BTCUSDT.P');
    expect(baseFromSymbol('1000PEPEUSDT.P')).toBe('1000PEPE');
    expect(baseFromSymbol('binance:BTCUSDT.P')).toBe('BTC');
    expect(symbolLabel('BTCUSDT')).toBe('BTC');
    expect(symbolLabel('binance:BTCUSDT.P')).toBe('BTC');
    expect(symbolLabel('OKX:BTC-USDT-SWAP')).toBe('BTC');
    expect(symbolLabel('COINBASE:BTC-USD')).toBe('BTC');
  });

  it('maps timeframes to Binance intervals', () => {
    expect(binanceInterval('15')).toBe('15m');
    expect(binanceInterval('60')).toBe('1h');
    expect(binanceInterval('D')).toBe('1d');
    expect(binanceInterval('1D')).toBe('1d');
    expect(binanceInterval('4H')).toBe('4h');
    expect(binanceInterval('1h')).toBe('1h');
    // 1M is a month; 1m is a minute.
    expect(binanceInterval('1M')).toBe('1M');
    expect(binanceInterval('1m')).toBe('1m');
    expect(() => binanceInterval('7')).toThrow('Unsupported timeframe');
  });
});

describe('formatters', () => {
  it('keeps price precision without hiding small prices', () => {
    expect(formatPrice(77919.2, 2)).toBe('77,919.20');
    expect(formatPrice(0.0049141, 7)).toBe('0.0049141');
    expect(formatPrice(null)).toBe('—');
  });

  it('formats percentages, volume and funding', () => {
    expect(formatPct(0.58)).toBe('+0.58%');
    expect(formatPct(-3.9)).toBe('-3.90%');
    expect(formatCompact(3_700_000_000)).toBe('3.70B');
    expect(formatFunding(0.0001)).toBe('+0.0100%');
  });

  it('labels Vela layouts', () => {
    expect(layoutLabel('1')).toBe('1');
    expect(layoutLabel('2h')).toBe('2×1');
    expect(layoutLabel('4')).toBe('2×2');
    expect(layoutLabel('g3x2')).toBe('3×2');
  });
});

describe('screener view persistence', () => {
  it('accepts the default view and rejects broken documents', () => {
    expect(isScreenerView(DEFAULT_VIEW)).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, filter: 'favorites' })).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, sort: null })).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, filter: 'wat' })).toBe(false);
    expect(isScreenerView({ ...DEFAULT_VIEW, sort: { key: 'price', dir: 2 } })).toBe(false);
    expect(isScreenerView(null)).toBe(false);
  });

  it('cycles a column through descending, ascending and unsorted', () => {
    const desc = nextSort(null, 'price');
    expect(desc).toEqual({ key: 'price', dir: -1 });
    const asc = nextSort(desc, 'price');
    expect(asc).toEqual({ key: 'price', dir: 1 });
    expect(nextSort(asc, 'price')).toBeNull();
    expect(nextSort(asc, 'volume')).toEqual({ key: 'volume', dir: -1 });
  });

  it('inserts the Venue column first in an old persisted order', () => {
    expect(
      mergeColumnOrder(
        ['symbol', 'price', 'change24h', 'quoteVolume', 'funding'],
        ['venue', 'symbol', 'price', 'change24h', 'quoteVolume', 'funding', 'plot:rsi'],
      ),
    ).toEqual([
      'venue',
      'symbol',
      'price',
      'change24h',
      'quoteVolume',
      'funding',
      'plot:rsi',
    ]);
  });

  it('validates the persisted favorites list', () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['BTCUSDT', 'ETHUSDT'])).toBe(true);
    expect(isStringArray(['BTCUSDT', 1])).toBe(false);
    expect(isStringArray('BTCUSDT')).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });
});

describe('multi-venue universe', () => {
  it('migrates legacy favorites to the instrument key', () => {
    expect(favoriteKey('BTCUSDT')).toBe('binance:perp:BTCUSDT');
    expect(favoriteKey('okx:perp:BTC-USDT-SWAP')).toBe('okx:perp:BTC-USDT-SWAP');
  });

  it('applies minVolume and topN per venue before merging', () => {
    const rows = [
      row('binance', 'A', 500),
      row('binance', 'B', 300),
      row('binance', 'C', 250),
      row('okx', 'A', 400),
      row('okx', 'B', 200),
    ];
    const kept = trimRowsPerVenue(rows, 260, 2);
    expect(
      kept.map((item) => `${item.instrument.venue}:${item.instrument.nativeId}`),
    ).toEqual(['binance:A', 'okx:A', 'binance:B']);
  });

  it('groups scanner targets in venue order', () => {
    const rows = [row('binance', 'A', 500), row('okx', 'A', 400), row('okx', 'B', 300)];
    const targets = scanTargetsFor(rows, ['okx', 'binance']);
    expect(targets.map((target) => target.venue)).toEqual(['okx', 'binance']);
    expect(targets[0]?.instruments.map((instrument) => instrument.nativeId)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('multi-venue market rows', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps healthy venues when one venue fails', async () => {
    vi.spyOn(SidecarVenueAdapter.prototype, 'fetchTickers').mockImplementation(
      async function (this: SidecarVenueAdapter) {
        if (this.id === 'okx') throw new Error('OKX is down');
        const instrument = makeInstrument({
          venue: 'binance',
          kind: 'perp',
          nativeId: 'BTCUSDT',
          base: 'BTC',
          quote: 'USDT',
          velaSymbol: 'BINANCE:BTCUSDT.P',
        });
        return [
          {
            instrument,
            last: 1,
            change24h: 1,
            quoteVolume: 100,
            funding: null,
            nextFunding: null,
          },
        ];
      },
    );

    const result = await fetchMarketRows(['binance', 'okx']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.instrument.key).toBe('binance:perp:BTCUSDT');
    expect(result.errors.okx).toBe('OKX is down');
  });
});
