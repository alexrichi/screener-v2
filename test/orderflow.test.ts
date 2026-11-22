import { describe, expect, it } from 'vitest';
import {
  autoGrouping,
  combineFills,
  DEFAULT_ORDER_FLOW_PREFERENCES,
  DEFAULT_ORDER_FLOW_SETTINGS,
  EMPTY_ORDER_FLOW_STATE,
  groupingOptions,
  mergeBooks,
  mergeTradeTotals,
  orderFlowReducer,
  orderFlowSymbolKey,
  settingsForSymbol,
  type OrderFlowTrade,
  type OrderFlowVenueBook,
} from '../src/lib/orderflow';
import {
  parseBinanceOrderFlow,
  parseBitgetOrderFlow,
  parseBybitOrderFlow,
  parseCoinbaseOrderFlow,
  parseHyperliquidOrderFlow,
  parseOkxOrderFlow,
  scaleMessage,
} from '../sidecar/orderflow/feeds';
import { choosePeer, combineBook, groupLevels } from '../sidecar/orderflow/service';
import { makeInstrument } from '../src/venues/instrument';

const BINANCE = makeInstrument({
  venue: 'binance',
  nativeId: 'BTCUSDT',
  base: 'BTC',
  quote: 'USDT',
  kind: 'perp',
  velaSymbol: 'BINANCE:BTCUSDT.P',
  pricePrecision: 1,
  tickSize: 0.1,
});
const BINANCE_USDC = makeInstrument({
  venue: 'binance',
  nativeId: 'BTCUSDC',
  base: 'BTC',
  quote: 'USDC',
  kind: 'perp',
  velaSymbol: 'BINANCE:BTCUSDC.P',
  pricePrecision: 1,
  tickSize: 0.1,
});
const COINBASE = makeInstrument({
  venue: 'coinbase',
  nativeId: 'BTC-USD',
  base: 'BTC',
  quote: 'USD',
  kind: 'spot',
  velaSymbol: 'COINBASE:BTC-USD',
  pricePrecision: 2,
  tickSize: 0.01,
});
const COINBASE_USDT = makeInstrument({
  venue: 'coinbase',
  nativeId: 'BTC-USDT',
  base: 'BTC',
  quote: 'USDT',
  kind: 'spot',
  velaSymbol: 'COINBASE:BTC-USDT',
  pricePrecision: 2,
  tickSize: 0.01,
});

function book(venue: string, bids: Array<[number, number]>, asks: Array<[number, number]>): OrderFlowVenueBook {
  return {
    venue,
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    at: 1,
  };
}

function trade(overrides: Partial<OrderFlowTrade> = {}): OrderFlowTrade {
  return {
    id: 't1',
    venue: 'binance',
    price: 100.1,
    size: 2,
    side: 'buy',
    time: 1_700_000_000_000,
    ...overrides,
  };
}

describe('order flow peers', () => {
  it('prefers the primary venue ticker and its quote', () => {
    expect(
      choosePeer(
        [BINANCE_USDC, BINANCE, COINBASE],
        'BTC',
        'USDT',
        'perp',
        BINANCE.key,
      )?.key,
    ).toBe(BINANCE.key);
  });

  it('matches another venue by base and a USD-like quote', () => {
    expect(choosePeer([COINBASE], 'BTC', 'USDT', 'perp', BINANCE.key)?.key).toBe(COINBASE.key);
  });

  it('reads a spot venue from its USD book when the chart is a perp', () => {
    expect(
      choosePeer([COINBASE_USDT, COINBASE], 'BTC', 'USDT', 'perp', BINANCE.key)?.key,
    ).toBe(COINBASE.key);
  });

  it('rejects a non-USD quote', () => {
    const eur = makeInstrument({
      venue: 'okx',
      nativeId: 'BTC-EUR',
      base: 'BTC',
      quote: 'EUR',
      kind: 'perp',
      velaSymbol: 'OKX:BTC-EUR',
    });
    expect(choosePeer([eur], 'BTC', 'USDT', 'perp', BINANCE.key)).toBeUndefined();
  });
});

describe('order flow book merge', () => {
  const left = book('binance', [[100.1, 2], [100, 1]], [[100.2, 3]]);
  const right = book('okx', [[100.1, 4]], [[100.3, 5]]);

  it('sums the same level across venues', () => {
    const merged = mergeBooks([left, right], 0.1);
    expect(merged.venues).toBe(2);
    expect(merged.bids).toEqual([
      { price: 100.1, size: 6 },
      { price: 100, size: 1 },
    ]);
    expect(merged.asks).toEqual([
      { price: 100.2, size: 3 },
      { price: 100.3, size: 5 },
    ]);
  });

  it('groups every venue onto the selected step', () => {
    const merged = mergeBooks([left, right], 1);
    expect(merged.bids).toEqual([{ price: 100, size: 7 }]);
    expect(merged.asks).toEqual([{ price: 100, size: 8 }]);
  });

  it('rebuckets traded volume onto the same step', () => {
    const totals = mergeTradeTotals(
      {
        binance: new Map([
          [1001, { buy: 2, sell: 0 }],
          [1002, { buy: 0, sell: 3 }],
        ]),
      },
      ['binance'],
      0.1,
      1,
    );
    expect(totals.get(100)).toEqual({ buy: 2, sell: 3 });
  });

  it('scales the grouping options to the instrument', () => {
    expect(groupingOptions(60_800, 0.1)).toEqual([0.1, 0.2, 0.5, 1, 2, 5, 10, 100, 1000]);
    expect(autoGrouping(60_800, 0.1)).toBe(100);
  });

  it('keeps Book, DOM and Trades settings per instrument', () => {
    expect(orderFlowSymbolKey('BTCUSDT.P')).toBe('BINANCE:BTCUSDT.P');
    const btc = settingsForSymbol(DEFAULT_ORDER_FLOW_PREFERENCES, 'BINANCE:BTCUSDT.P');
    const prefs = {
      ...DEFAULT_ORDER_FLOW_PREFERENCES,
      tab: 'book' as const,
      symbols: {
        'BINANCE:BTCUSDT.P': {
          ...btc,
          grouping: 100,
          book: { ...btc.book, zoom: 120 },
        },
      },
    };
    expect(settingsForSymbol(prefs, 'BINANCE:BTCUSDT.P').grouping).toBe(100);
    expect(settingsForSymbol(prefs, 'BINANCE:BTCUSDT.P').book.zoom).toBe(120);
    expect(settingsForSymbol(prefs, 'BINANCE:BTCUSDT.P').tab).toBe('book');
    expect(settingsForSymbol(prefs, 'BINANCE:ETHUSDT.P').grouping).toBe(
      DEFAULT_ORDER_FLOW_SETTINGS.grouping,
    );
    expect(settingsForSymbol(prefs, 'BINANCE:ETHUSDT.P').book.zoom).toBe(100);
  });

  it('groups raw levels at the requested step', () => {
    expect(
      groupLevels(
        [
          { price: 100.1, size: 2 },
          { price: 100.4, size: 3 },
        ],
        1,
        'bid',
      ),
    ).toEqual([{ price: 100, size: 5 }]);
  });

  it('combines venues around the chart venue and clips the wrong side', () => {
    const now = Date.now();
    const combined = combineBook(
      new Map([
        [
          'binance',
          {
            bids: [{ price: 100.1, size: 2 }],
            asks: [{ price: 100.2, size: 3 }],
            at: now,
          },
        ],
        [
          'okx',
          {
            bids: [{ price: 100.4, size: 4 }],
            asks: [{ price: 100.3, size: 5 }],
            at: now,
          },
        ],
      ]),
      new Set(['binance', 'okx']),
      'binance',
      0.1,
      now,
    );
    expect(combined.venues).toEqual(['binance', 'okx']);
    expect(combined.bids).toEqual([{ price: 100.1, size: 2 }]);
    expect(combined.asks).toEqual([
      { price: 100.2, size: 3 },
      { price: 100.3, size: 5 },
    ]);
  });
});

describe('order flow fills', () => {
  it('joins fills of one order', () => {
    const combined = combineFills([
      trade({ id: 'a', size: 1, group: 'order-1', time: 10 }),
      trade({ id: 'b', size: 2, group: 'order-1', time: 11 }),
    ]);
    expect(combined).toHaveLength(1);
    expect(combined[0]?.size).toBe(3);
    expect(combined[0]?.time).toBe(11);
  });

  it('joins fills without an order id inside 10 ms', () => {
    const combined = combineFills([
      trade({ id: 'a', size: 1, time: 10 }),
      trade({ id: 'b', size: 2, time: 12 }),
      trade({ id: 'c', size: 3, time: 40 }),
    ]);
    expect(combined).toHaveLength(2);
    expect(combined[0]?.size).toBe(3);
    expect(combined[1]?.size).toBe(3);
  });
});

describe('order flow parser fixtures', () => {
  it('reads Binance depth and aggressor side', () => {
    const depth = parseBinanceOrderFlow(
      JSON.stringify({
        stream: 'btcusdt@depth20@100ms',
        data: { e: 'depthUpdate', b: [['100.1', '2']], a: [['100.2', '3']] },
      }),
    );
    expect(depth?.book?.bids).toEqual([[100.1, 2]]);
    expect(depth?.book?.snapshot).toBe(true);

    const aggressor = parseBinanceOrderFlow(
      JSON.stringify({
        data: { e: 'trade', t: 7, p: '100.1', q: '0.5', T: 1_700_000_000_000, m: true },
      }),
    );
    expect(aggressor?.trades?.[0]).toMatchObject({
      side: 'sell',
      size: 0.5,
      group: '1700000000000',
    });
  });

  it('reads OKX snapshots, updates and trades', () => {
    const snapshot = parseOkxOrderFlow(
      JSON.stringify({
        arg: { channel: 'books', instId: 'BTC-USDT-SWAP' },
        action: 'snapshot',
        data: [
          {
            asks: [['100.2', '3', '0', '1']],
            bids: [['100.1', '2', '0', '1']],
            seqId: 10,
            prevSeqId: -1,
          },
        ],
      }),
    );
    expect(snapshot?.book).toMatchObject({ snapshot: true, seq: 10 });
    expect(snapshot?.book?.bids).toEqual([[100.1, 2]]);

    const update = parseOkxOrderFlow(
      JSON.stringify({
        arg: { channel: 'books', instId: 'BTC-USDT-SWAP' },
        action: 'update',
        data: [{ asks: [], bids: [['100.1', '0']], seqId: 11, prevSeqId: 10 }],
      }),
    );
    expect(update?.book).toMatchObject({ snapshot: false, seq: 11, prevSeq: 10 });

    const trades = parseOkxOrderFlow(
      JSON.stringify({
        arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' },
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            tradeId: '9',
            px: '100.2',
            sz: '0.3',
            side: 'sell',
            ts: '1700000000000',
          },
        ],
      }),
    );
    expect(trades?.trades?.[0]).toMatchObject({ side: 'sell', price: 100.2, size: 0.3 });
  });

  it('reads Bybit order book and taker trades', () => {
    const snapshot = parseBybitOrderFlow(
      JSON.stringify({
        topic: 'orderbook.50.BTCUSDT',
        type: 'snapshot',
        data: { b: [['100.1', '2']], a: [['100.2', '3']], u: 5 },
      }),
    );
    expect(snapshot?.book).toMatchObject({ snapshot: true });
    expect(snapshot?.book?.asks).toEqual([[100.2, 3]]);

    const trades = parseBybitOrderFlow(
      JSON.stringify({
        topic: 'publicTrade.BTCUSDT',
        type: 'snapshot',
        data: [{ T: 1_700_000_000_000, S: 'Buy', v: '0.5', p: '100.1', i: 'abc' }],
      }),
    );
    expect(trades?.trades?.[0]).toMatchObject({ side: 'buy', id: 'abc' });
  });

  it('reads Bitget books and trades', () => {
    const snapshot = parseBitgetOrderFlow(
      JSON.stringify({
        action: 'snapshot',
        arg: { channel: 'books', instId: 'BTCUSDT' },
        data: [{ asks: [['100.2', '3']], bids: [['100.1', '2']], seq: 4 }],
      }),
    );
    expect(snapshot?.book).toMatchObject({ snapshot: true });

    const trades = parseBitgetOrderFlow(
      JSON.stringify({
        action: 'snapshot',
        arg: { channel: 'trade', instId: 'BTCUSDT' },
        data: [
          { price: '100.2', size: '0.3', side: 'sell', ts: '1700000000000', tradeId: '9' },
        ],
      }),
    );
    expect(trades?.trades?.[0]).toMatchObject({ side: 'sell', id: '9' });
  });

  it('reads Hyperliquid levels and trades', () => {
    const snapshot = parseHyperliquidOrderFlow(
      JSON.stringify({
        channel: 'l2Book',
        data: {
          coin: 'BTC',
          time: 1_700_000_000_000,
          levels: [
            [{ px: '100.1', sz: '2', n: 1 }],
            [{ px: '100.2', sz: '3', n: 1 }],
          ],
        },
      }),
    );
    expect(snapshot?.book).toMatchObject({ snapshot: true });
    expect(snapshot?.book?.bids).toEqual([[100.1, 2]]);

    const trades = parseHyperliquidOrderFlow(
      JSON.stringify({
        channel: 'trades',
        data: [{ coin: 'BTC', side: 'B', px: '100.1', sz: '0.5', time: 1_700_000_000_000, tid: 9 }],
      }),
    );
    expect(trades?.trades?.[0]).toMatchObject({ side: 'buy', id: '9' });
  });

  it('reads Coinbase books, changes and the taker side', () => {
    const snapshot = parseCoinbaseOrderFlow(
      JSON.stringify({
        type: 'snapshot',
        product_id: 'BTC-USD',
        bids: [['100.1', '2']],
        asks: [['100.2', '3']],
      }),
    );
    expect(snapshot?.book).toMatchObject({ snapshot: true });
    expect(snapshot?.book?.bids).toEqual([[100.1, 2]]);

    const update = parseCoinbaseOrderFlow(
      JSON.stringify({
        type: 'l2update',
        changes: [
          ['buy', '100.1', '0'],
          ['sell', '100.2', '4'],
        ],
      }),
    );
    expect(update?.book).toMatchObject({ snapshot: false });
    expect(update?.book?.bids).toEqual([[100.1, 0]]);
    expect(update?.book?.asks).toEqual([[100.2, 4]]);

    const match = parseCoinbaseOrderFlow(
      JSON.stringify({
        type: 'match',
        side: 'buy',
        price: '100.1',
        size: '0.5',
        time: '2023-11-14T22:13:20.000Z',
        trade_id: 9,
        taker_order_id: 'taker-1',
      }),
    );
    expect(match?.trades?.[0]).toMatchObject({
      side: 'sell',
      price: 100.1,
      group: 'taker-1',
      time: 1_700_000_000_000,
    });
  });

  it('ignores heartbeats and acknowledgements', () => {
    expect(parseCoinbaseOrderFlow(JSON.stringify({ type: 'heartbeat' }))).toBeUndefined();
    expect(parseOkxOrderFlow(JSON.stringify({ event: 'subscribe' }))).toBeUndefined();
    expect(parseBitgetOrderFlow('pong')).toBeUndefined();
  });

  it('scales contract-denominated sizes to base units', () => {
    const scaled = scaleMessage(
      {
        book: { bids: [[100, 2]], asks: [[101, 3]] },
        trades: [{ id: '1', price: 100, size: 2, side: 'buy', time: 1 }],
      },
      0.01,
    );
    expect(scaled.book?.bids).toEqual([[100, 0.02]]);
    expect(scaled.book?.asks).toEqual([[101, 0.03]]);
    expect(scaled.trades?.[0]?.size).toBe(0.02);
  });
});

describe('order flow reducer', () => {
  const ready = {
    type: 'ready' as const,
    symbol: 'BINANCE:BTCUSDT.P',
    base: 'BTC',
    quote: 'USDT',
    kind: 'perp' as const,
    peers: [
      {
        venue: 'binance',
        instrumentKey: BINANCE.key,
        display: 'BTCUSDT.P',
        kind: 'perp' as const,
        tickSize: 0.1,
      },
    ],
    tickSize: 0.1,
    pricePrecision: 1,
  };

  it('accumulates trades at the fine tick and resets the window', () => {
    let state = orderFlowReducer(EMPTY_ORDER_FLOW_STATE, { type: 'frame', frame: ready });
    state = orderFlowReducer(state, {
      type: 'frame',
      frame: {
        type: 'trades',
        trades: [
          trade({ id: 'a', side: 'buy', size: 2 }),
          trade({ id: 'b', side: 'sell', size: 1, price: 100.2 }),
        ],
      },
    });
    expect(state.trades).toHaveLength(2);
    expect(state.buckets.binance?.get(1001)).toEqual({ buy: 2, sell: 0 });
    expect(state.buckets.binance?.get(1002)).toEqual({ buy: 0, sell: 1 });

    state = orderFlowReducer(state, { type: 'reset-window' });
    expect(state.trades).toHaveLength(0);
    expect(state.buckets).toEqual({});
  });

  it('drops a venue\'s trades and buckets', () => {
    let state = orderFlowReducer(EMPTY_ORDER_FLOW_STATE, { type: 'frame', frame: ready });
    state = orderFlowReducer(state, {
      type: 'frame',
      frame: {
        type: 'book',
        bids: [{ price: 100, size: 2 }],
        asks: [{ price: 101, size: 3 }],
        venues: ['binance', 'okx'],
        stale: [],
        at: 1,
      },
    });
    state = orderFlowReducer(state, {
      type: 'frame',
      frame: {
        type: 'trades',
        trades: [trade(), trade({ id: 'okx-1', venue: 'okx', price: 100.2 })],
      },
    });
    state = orderFlowReducer(state, { type: 'drop', venues: ['okx'] });
    expect(state.book?.bids).toEqual([{ price: 100, size: 2 }]);
    expect(state.trades.every((item) => item.venue === 'binance')).toBe(true);
    expect(state.buckets.okx).toBeUndefined();
  });

  it('clears the previous symbol on a new ready frame', () => {
    let state = orderFlowReducer(EMPTY_ORDER_FLOW_STATE, { type: 'frame', frame: ready });
    state = orderFlowReducer(state, {
      type: 'frame',
      frame: { type: 'trades', trades: [trade()] },
    });
    state = orderFlowReducer(state, {
      type: 'frame',
      frame: { ...ready, symbol: 'OKX:BTC-USDT-SWAP' },
    });
    expect(state.symbol).toBe('OKX:BTC-USDT-SWAP');
    expect(state.trades).toHaveLength(0);
  });
});
