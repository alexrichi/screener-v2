import { describe, expect, it } from 'vitest';
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
  formatNumber,
  formatPct,
  formatPrice,
  layoutLabel,
} from '../src/lib/format';
import {
  BASE_COLUMN_KEYS,
  DEFAULT_VIEW,
  isScreenerView,
  mergeColumnOrder,
  nextSort,
} from '../src/lib/view';
import { isStringArray } from '../src/lib/usePersistedState';
import {
  favoriteKey,
  scanTargetsFor,
} from '../src/lib/universe';
import type { MarketRow, ScreenerRow, ScreenerStatus, VenueId } from '../src/types';
import { mergeScreenerRows } from '../src/lib/screenerClient';
import { filterScreenerRows } from '../src/lib/screenerFilter';
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

function screenerRow(
  nativeId: string,
  quoteVolume: number,
  metrics: Partial<ScreenerRow['metrics']> = {},
): ScreenerRow {
  return {
    instrument: makeInstrument({
      venue: 'binance',
      kind: 'perp',
      nativeId,
      base: 'BTC',
      quote: 'USDT',
      velaSymbol: `BINANCE:${nativeId}.P`,
    }),
    price: 1,
    change24h: 1,
    quoteVolume,
    funding: null,
    nextFunding: null,
    metrics: {
      sessionRangePct: null,
      volumeChange24hPct: null,
      rvol: null,
      vwapZ: null,
      rsi: null,
      ...metrics,
    },
    updatedAt: 0,
    warming: false,
    missing: [],
    staleMetrics: [],
  };
}

describe('screener row patches', () => {
  it('upserts, removes and keeps the 24h-volume order', () => {
    const btc = screenerRow('BTCUSDT', 100);
    const eth = screenerRow('ETHUSDT', 50);
    const status: ScreenerStatus = {
      ready: true,
      watched: 2,
      warming: 0,
      lastUpdate: 1,
      venues: [],
    };

    const next = mergeScreenerRows([btc, eth], {
      rows: [screenerRow('SOLUSDT', 200), { ...btc, quoteVolume: 10 }],
      removed: [eth.instrument.key],
      status,
    });

    expect(next.map((item) => item.instrument.nativeId)).toEqual([
      'SOLUSDT',
      'BTCUSDT',
    ]);
    expect(next[1].quoteVolume).toBe(10);
  });
});

describe('screener filters', () => {
  const oversold = { rsi: 20, rvol: 0.9, vwapZ: -1 };
  const btc = screenerRow('BTCUSDT', 300, oversold);
  const eth = screenerRow('ETHUSDT', 200, oversold);
  const sol = screenerRow('SOLUSDT', 100, { rsi: 55 });
  const noMetrics = screenerRow('DOGEUSDT', 50);
  const favorites = new Set([btc.instrument.key]);

  it('combines the favorite scope with every active quick filter', () => {
    const rows = [btc, eth, sol, noMetrics];
    expect(
      filterScreenerRows(
        rows,
        { filters: ['rsiLow'], favoritesOnly: true, query: '' },
        favorites,
      ).map((row) => row.instrument.nativeId),
    ).toEqual(['BTCUSDT']);
    expect(
      filterScreenerRows(
        rows,
        { filters: ['rsiLow'], favoritesOnly: false, query: '' },
        favorites,
      ).map((row) => row.instrument.nativeId),
    ).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('ANDs independent quick filters', () => {
    const gainer = screenerRow('SOLUSDT', 100, { rsi: 20, rvol: 2 });
    const rows = [btc, eth, sol, gainer];
    expect(
      filterScreenerRows(
        rows,
        { filters: ['rsiLow', 'rvol'], query: '' },
        favorites,
      ).map((row) => row.instrument.nativeId),
    ).toEqual(['SOLUSDT']);
  });

  it('reads the legacy favorites filter as the favorite scope', () => {
    expect(
      filterScreenerRows(
        [btc, eth],
        { filter: 'favorites', query: '' },
        favorites,
      ).map((row) => row.instrument.nativeId),
    ).toEqual(['BTCUSDT']);
    expect(
      filterScreenerRows(
        [btc, eth, sol],
        { filter: 'rsiLow', query: '' },
        favorites,
      ).map((row) => row.instrument.nativeId),
    ).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('applies the search inside the favorite scope', () => {
    expect(
      filterScreenerRows(
        [btc, eth],
        { favoritesOnly: true, query: 'eth' },
        favorites,
      ),
    ).toEqual([]);
    expect(
      filterScreenerRows(
        [btc, eth],
        { favoritesOnly: true, query: 'btc' },
        favorites,
      ).map((row) => row.instrument.nativeId),
    ).toEqual(['BTCUSDT']);
  });
});

describe('binance symbols and intervals', () => {
  it('maps Vela futures symbols both ways', () => {
    expect(chartSymbol('BTCUSDT')).toBe('BTCUSDT.P');
    expect(chartSymbol('BTCUSDT.P')).toBe('BTCUSDT.P');
    expect(chartSymbol('binance:BTCUSDT')).toBe('binance:BTCUSDT');
    expect(chartSymbol('binance:BTCUSDT.P')).toBe('binance:BTCUSDT.P');
    expect(chartSymbol('BINANCE:BTCUSDT')).toBe('BINANCE:BTCUSDT');
    expect(chartSymbol('OKX:BTC-USDT-SWAP')).toBe('OKX:BTC-USDT-SWAP');
    expect(spotSymbol('BTCUSDT.P')).toBe('BTCUSDT');
    expect(spotSymbol('BINANCE:BTCUSDT.P')).toBe('BINANCE:BTCUSDT.P');
    expect(spotSymbol('BINANCE:BTCUSDT')).toBe('BINANCE:BTCUSDT');
    expect(baseFromSymbol('1000PEPEUSDT.P')).toBe('1000PEPE');
    expect(baseFromSymbol('binance:BTCUSDT.P')).toBe('BTC');
    expect(baseFromSymbol('binance:BTCUSDT')).toBe('BTC');
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
    expect(formatPrice(77919.2, 2)).toBe('77\u00a0919.20');
    expect(formatPrice(0.0049141, 7)).toBe('0.0049141');
    expect(formatPrice(null)).toBe('—');
    expect(formatNumber(123456.789)).toBe('123\u00a0456.789');
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

  it('keeps the metric quick filters', () => {
    for (const filter of [
      'rsiLow',
      'rsiHigh',
      'rvol',
      'aboveVwap',
      'belowVwap',
    ] as const) {
      expect(isScreenerView({ ...DEFAULT_VIEW, filter })).toBe(true);
      expect(isScreenerView({ ...DEFAULT_VIEW, filters: [filter] })).toBe(true);
    }
    expect(
      isScreenerView({ ...DEFAULT_VIEW, filters: ['rsiLow', 'rvol'] }),
    ).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, filters: ['all'] })).toBe(false);
    expect(isScreenerView({ ...DEFAULT_VIEW, filters: 'rsiLow' })).toBe(false);
  });

  it('accepts the favorite scope and old views without it', () => {
    expect(isScreenerView({ ...DEFAULT_VIEW, favoritesOnly: true })).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, favoritesOnly: false })).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, favoritesOnly: 'yes' })).toBe(false);
    const { favoritesOnly: _favorites, filters: _filters, ...old } = DEFAULT_VIEW;
    expect(isScreenerView(old)).toBe(true);
  });

  it('keeps the metric columns in a persisted order', () => {
    expect(BASE_COLUMN_KEYS).toEqual([
      'venue',
      'symbol',
      'price',
      'change24h',
      'range',
      'quoteVolume',
      'volumeChange',
      'rvol',
      'funding',
      'vwap',
      'rsi',
    ]);
    expect(
      mergeColumnOrder(['symbol', 'quoteVolume'], [...BASE_COLUMN_KEYS, 'plot:rsi']),
    ).toEqual([...BASE_COLUMN_KEYS, 'plot:rsi']);
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
