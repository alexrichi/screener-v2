import { describe, expect, it, vi } from 'vitest';
import { ScreenerService } from '../sidecar/screener';
import type { VenueHub } from '../sidecar/hub';
import type { BarsStream } from '../sidecar/stream';
import type { Instrument, VenueBar, VenueTicker } from '../src/venues/types';
import type { VenueId } from '../src/types';
import { makeInstrument } from '../src/venues/instrument';

const instrument: Instrument = makeInstrument({
  venue: 'binance',
  nativeId: 'BTCUSDT',
  base: 'BTC',
  quote: 'USDT',
  kind: 'perp',
  velaSymbol: 'BINANCE:BTCUSDT.P',
  pricePrecision: 2,
});

const ticker = (quoteVolume: number): VenueTicker => ({
  instrument,
  last: 200,
  change24h: 1.5,
  quoteVolume,
  funding: 0.0001,
  nextFunding: null,
});

function bars(count = 200): VenueBar[] {
  const tf = 15 * 60_000;
  const started = Date.now() - (count + 1) * tf;
  return Array.from({ length: count }, (_, index) => {
    const openTime = started + index * tf;
    return {
      openTime,
      closeTime: openTime + tf - 1,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 10,
    };
  });
}

function fakeHub(series = bars()): {
  hub: VenueHub;
  calls: () => number;
  setQuote: (quoteVolume: number) => void;
} {
  let quoteVolume = 2_000_000;
  let calls = 0;
  const hub = {
    getInstruments: async () => [instrument],
    getTickers: async () => [ticker(quoteVolume)],
    getSeries: async (_instrument: Instrument, _timeframe: string, opts: { limit: number }) => {
      calls += 1;
      return series.slice(-opts.limit);
    },
  } as unknown as VenueHub;
  return {
    hub,
    calls: () => calls,
    setQuote: (value) => {
      quoteVolume = value;
    },
  };
}

function fakeStream(): {
  stream: BarsStream;
  subscribes: () => number;
  push: (bar: VenueBar) => void;
} {
  let subscribes = 0;
  let listener: ((bar: VenueBar) => void) | null = null;
  const stream = {
    streamCount: 0,
    barCount: 0,
    pollCount: 0,
    subscribe: (_instrument: Instrument, _timeframe: string, onBar: (bar: VenueBar) => void) => {
      subscribes += 1;
      listener = onBar;
      return () => {
        listener = null;
      };
    },
  } as unknown as BarsStream;
  return {
    stream,
    subscribes: () => subscribes,
    push: (bar) => listener?.(bar),
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('screener service', () => {
  it('activates a watched row, warms it and computes metrics', async () => {
    const { hub, calls } = fakeHub();
    const stream = fakeStream();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', stream.stream]]),
      config: { minVolume: 1_000_000 },
    });

    await service.poll();
    await settle();

    const snapshot = service.snapshot();
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.instrument.key).toBe(instrument.key);
    expect(snapshot.rows[0]?.warming).toBe(false);
    expect(snapshot.rows[0]?.metrics.rsi).not.toBeNull();
    expect(calls()).toBe(1);
    expect(stream.subscribes()).toBe(1);

    await service.poll();
    await settle();
    expect(calls()).toBe(1);
    expect(stream.subscribes()).toBe(1);
    service.stop();
  });

  it('does not watch instruments below the threshold', async () => {
    const { hub, setQuote } = fakeHub();
    setQuote(500_000);
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', fakeStream().stream]]),
      config: { minVolume: 1_000_000 },
    });
    await service.poll();
    expect(service.snapshot().rows).toEqual([]);
    service.stop();
  });

  it('re-subscribes and re-warms after a technical timeframe change', async () => {
    const { hub, calls } = fakeHub();
    const stream = fakeStream();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', stream.stream]]),
      config: { minVolume: 1_000_000 },
    });
    await service.poll();
    await settle();
    expect(calls()).toBe(1);

    service.setConfig({ timeframe: '30' });
    await settle();
    expect(stream.subscribes()).toBe(2);
    expect(calls()).toBe(2);
    service.stop();
  });

  it('drops a warm result from before a timeframe change', async () => {
    let release!: (value: VenueBar[]) => void;
    const stale = new Promise<VenueBar[]>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const hub = {
      getInstruments: async () => [instrument],
      getTickers: async () => [ticker(2_000_000)],
      getSeries: async () => {
        call += 1;
        return call === 1 ? stale : bars();
      },
    } as unknown as VenueHub;
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', fakeStream().stream]]),
      config: { minVolume: 1_000_000 },
    });

    await service.poll();
    service.setConfig({ timeframe: '30' });
    await settle();
    const fresh = service.snapshot().rows[0]!.metrics;

    release([
      {
        openTime: Date.now() - 60_000,
        closeTime: Date.now() - 1,
        open: 1,
        high: 2,
        low: 1,
        close: 1,
        volume: 1,
      },
    ]);
    await settle();
    expect(call).toBe(2);
    expect(service.snapshot().rows[0]!.metrics).toEqual(fresh);
    service.stop();
  });

  it('watches only the selected venues', async () => {
    const makeHub = (venue: 'binance' | 'okx', nativeId: string) => {
      const item = makeInstrument({
        venue,
        kind: 'perp',
        nativeId,
        base: 'BTC',
        quote: 'USDT',
        velaSymbol: `${venue.toUpperCase()}:${nativeId}`,
      });
      const hub = {
        getTickers: async () => [
          {
            instrument: item,
            last: 1,
            change24h: 0,
            quoteVolume: 2_000_000,
            funding: null,
            nextFunding: null,
          },
        ],
        getSeries: async () => bars(),
      } as unknown as VenueHub;
      return { item, hub };
    };
    const binance = makeHub('binance', 'BTCUSDT');
    const okx = makeHub('okx', 'BTC-USDT-SWAP');
    const service = new ScreenerService({
      hubs: new Map([
        ['binance', binance.hub],
        ['okx', okx.hub],
      ]),
      streams: new Map(),
      config: { minVolume: 1_000_000, venues: ['binance'] },
    });

    await service.poll();
    await settle();
    expect(service.snapshot().rows.map((row) => row.instrument.venue)).toEqual([
      'binance',
    ]);

    const removed: string[] = [];
    service.onPatch((patch) => removed.push(...patch.removed));
    service.setConfig({ venues: ['okx'] });
    await service.poll();
    await settle();
    expect(removed).toContain(binance.item.key);
    expect(service.snapshot().rows.map((row) => row.instrument.venue)).toEqual(['okx']);
    service.stop();
  });

  it('updates a row from a streamed bar', async () => {
    const { hub } = fakeHub();
    const stream = fakeStream();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', stream.stream]]),
      config: { minVolume: 1_000_000 },
    });
    await service.poll();
    await settle();
    const before = service.snapshot().rows[0]!.metrics.vwapZ;
    stream.push({
      openTime: Date.now() - 15 * 60_000,
      closeTime: Date.now() - 1,
      open: 300,
      high: 301,
      low: 299,
      close: 300,
      volume: 10,
    });
    const after = service.snapshot().rows[0]!.metrics.vwapZ;
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    service.stop();
  });

  it('warms one venue while another venue is stuck', async () => {
    const stuck = (base: string): Instrument =>
      makeInstrument({
        venue: 'binance',
        kind: 'perp',
        nativeId: `${base}USDT`,
        base,
        quote: 'USDT',
        velaSymbol: `BINANCE:${base}USDT.P`,
      });
    const binanceItems = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'].map(stuck);
    const binanceHub = {
      getInstruments: async () => binanceItems,
      getTickers: async () =>
        binanceItems.map((item) => ({
          instrument: item,
          last: 1,
          change24h: 0,
          quoteVolume: 2_000_000,
          funding: null,
          nextFunding: null,
        })),
      getSeries: () => new Promise<VenueBar[]>(() => {}),
    } as unknown as VenueHub;

    const okxItem = makeInstrument({
      venue: 'okx',
      kind: 'perp',
      nativeId: 'BTC-USDT-SWAP',
      base: 'BTC',
      quote: 'USDT',
      velaSymbol: 'OKX:BTC-USDT-SWAP',
    });
    const okxHub = {
      getInstruments: async () => [okxItem],
      getTickers: async () => [
        {
          instrument: okxItem,
          last: 1,
          change24h: 0,
          quoteVolume: 2_000_000,
          funding: null,
          nextFunding: null,
        },
      ],
      getSeries: async () => bars(),
    } as unknown as VenueHub;

    const service = new ScreenerService({
      hubs: new Map<VenueId, VenueHub>([
        ['binance', binanceHub],
        ['okx', okxHub],
      ]),
      streams: new Map(),
      config: { minVolume: 1_000_000 },
    });

    await service.poll();
    await settle();

    const rows = service.snapshot().rows;
    const okxRow = rows.find((row) => row.instrument.venue === 'okx');
    expect(okxRow?.warming).toBe(false);
    expect(okxRow?.metrics.rsi).not.toBeNull();
    // Binance slots are all parked on the hung requests; that must not hold OKX.
    expect(
      rows.filter((row) => row.instrument.venue === 'binance').every((row) => row.warming),
    ).toBe(true);
    service.stop();
  });

  it('polls venues in parallel', async () => {
    let releaseBinance!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBinance = resolve;
    });
    const binanceHub = {
      getInstruments: async () => [instrument],
      getTickers: async () => {
        await gate;
        return [ticker(2_000_000)];
      },
      getSeries: async () => bars(),
    } as unknown as VenueHub;

    const okxItem = makeInstrument({
      venue: 'okx',
      kind: 'perp',
      nativeId: 'BTC-USDT-SWAP',
      base: 'BTC',
      quote: 'USDT',
      velaSymbol: 'OKX:BTC-USDT-SWAP',
    });
    const okxHub = {
      getInstruments: async () => [okxItem],
      getTickers: async () => [
        {
          instrument: okxItem,
          last: 1,
          change24h: 0,
          quoteVolume: 2_000_000,
          funding: null,
          nextFunding: null,
        },
      ],
      getSeries: async () => bars(),
    } as unknown as VenueHub;

    const service = new ScreenerService({
      hubs: new Map<VenueId, VenueHub>([
        ['binance', binanceHub],
        ['okx', okxHub],
      ]),
      streams: new Map(),
      config: { minVolume: 1_000_000 },
    });

    const polled = service.poll();
    await settle();
    // Binance still hangs; OKX must already be watched.
    expect(service.snapshot().rows.map((row) => row.instrument.venue)).toEqual(['okx']);

    releaseBinance();
    await polled;
    await settle();
    expect(service.snapshot().rows.map((row) => row.instrument.venue).sort()).toEqual([
      'binance',
      'okx',
    ]);
    service.stop();
  });
});
