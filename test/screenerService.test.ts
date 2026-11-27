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
  // End on the last closed bar so the UTC session always has at least one bar;
  // an older tail leaves the session metrics empty right after midnight.
  const started = Date.now() - count * tf;
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
  refreshBars: () => number[];
  setQuote: (quoteVolume: number) => void;
} {
  let quoteVolume = 2_000_000;
  let calls = 0;
  const refreshBars: number[] = [];
  const hub = {
    getInstruments: async () => [instrument],
    getTickers: async () => [ticker(quoteVolume)],
    getSeries: async (
      _instrument: Instrument,
      _timeframe: string,
      opts: { limit: number; refreshBars?: number },
    ) => {
      calls += 1;
      if (opts.refreshBars !== undefined) refreshBars.push(opts.refreshBars);
      return series.slice(-opts.limit);
    },
  } as unknown as VenueHub;
  return {
    hub,
    calls: () => calls,
    refreshBars: () => refreshBars,
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
      config: {},
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

  it('re-subscribes streams after the client reconnects', async () => {
    const { hub } = fakeHub();
    const stream = fakeStream();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', stream.stream]]),
      config: {},
    });

    await service.poll();
    await settle();
    expect(stream.subscribes()).toBe(1);

    service.stop();
    service.start();
    await settle();
    expect(stream.subscribes()).toBe(2);
    service.stop();
  });

  it('refreshes the full window when the series tail is stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const { hub, refreshBars } = fakeHub();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', fakeStream().stream]]),
      config: {},
    });
    try {
      await service.poll();
      await settle();
      expect(refreshBars()).toEqual([]);

      // A suspended machine or a stopped service leaves the tail hours behind.
      vi.setSystemTime(new Date('2026-11-18T16:00:00Z'));
      (service as unknown as { refreshDue(): void }).refreshDue();
      await settle();
      expect(refreshBars()).toEqual([818]);
      expect(service.snapshot().rows[0]!.metrics.rsi).not.toBeNull();
    } finally {
      service.stop();
      vi.useRealTimers();
    }
  });

  it('drops metrics on a series gap until a full refresh fills it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const { hub, refreshBars } = fakeHub();
    const stream = fakeStream();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', stream.stream]]),
      config: {},
    });
    try {
      await service.poll();
      await settle();
      expect(service.snapshot().rows[0]!.metrics.rsi).not.toBeNull();

      // The stream resumes hours later: the next bar skips the hole.
      const resumed = Date.now() + 4 * 60 * 60_000;
      stream.push({
        openTime: resumed,
        closeTime: resumed + 15 * 60_000 - 1,
        open: 300,
        high: 301,
        low: 299,
        close: 300,
        volume: 10,
      });
      const gapped = service.snapshot().rows[0]!;
      expect(gapped.metrics.rsi).toBeNull();
      expect(gapped.metrics.rvol).toBeNull();

      vi.setSystemTime(new Date(Date.now() + 3 * 60_000));
      (service as unknown as { refreshDue(): void }).refreshDue();
      await settle();
      expect(refreshBars()).toEqual([818]);
      expect(service.snapshot().rows[0]!.metrics.rsi).not.toBeNull();
    } finally {
      service.stop();
      vi.useRealTimers();
    }
  });

  it('does not watch instruments below the threshold', async () => {
    const { hub, setQuote } = fakeHub();
    setQuote(500_000);
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', fakeStream().stream]]),
      config: {},
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
      config: {},
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
      config: {},
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
      config: { venues: ['binance'] },
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

  it('does not bring back a venue unchecked during its ticker poll', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seriesCalls: string[] = [];
    const hub = {
      getTickers: async () => {
        await gate;
        return [ticker(2_000_000)];
      },
      getSeries: async (item: Instrument) => {
        seriesCalls.push(item.key);
        return bars();
      },
    } as unknown as VenueHub;
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map(),
      config: { venues: ['binance'] },
    });
    const polling = service.poll();
    service.setConfig({ venues: [] });
    release();
    await polling;
    await settle();
    expect(service.snapshot().rows).toEqual([]);
    expect(seriesCalls).toEqual([]);
    service.stop();
  });

  it('drops queued warm work when its venue is unchecked', async () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      makeInstrument({
        venue: 'binance',
        kind: 'perp',
        nativeId: `T${index}USDT`,
        base: `T${index}`,
        quote: 'USDT',
        velaSymbol: `BINANCE:T${index}USDT.P`,
      }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let seriesCalls = 0;
    const hub = {
      getTickers: async () =>
        items.map((item) => ({
          instrument: item,
          last: 1,
          change24h: 0,
          quoteVolume: 2_000_000,
          funding: null,
          nextFunding: null,
        })),
      getSeries: async () => {
        seriesCalls += 1;
        await gate;
        return bars();
      },
    } as unknown as VenueHub;
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map(),
      config: { venues: ['binance'] },
    });
    await service.poll();
    expect(seriesCalls).toBe(4);
    service.setConfig({ venues: [] });
    release();
    await settle();
    await settle();
    expect(seriesCalls).toBe(4);
    service.stop();
  });

  it('stops the venue funding socket when the venue is unchecked', async () => {
    let stops = 0;
    const hub = {
      getTickers: async () => [ticker(2_000_000)],
      getSeries: async () => bars(),
      stopFunding: () => {
        stops += 1;
      },
    } as unknown as VenueHub;
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map(),
      config: { venues: ['binance'] },
    });
    await service.poll();
    await settle();
    service.setConfig({ venues: [] });
    expect(stops).toBe(1);
    service.setConfig({ venues: ['binance'] });
    expect(stops).toBe(1);
    service.stop();
  });

  it('updates a row from a streamed bar', async () => {
    // Session metrics are empty for the first bars after UTC midnight, so pin
    // the clock to noon to keep this independent of when the suite runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const { hub } = fakeHub();
    const stream = fakeStream();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map([['binance', stream.stream]]),
      config: {},
    });
    try {
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
    } finally {
      service.stop();
      vi.useRealTimers();
    }
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
      config: {},
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
    });    const binanceHub = {
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
      config: {},
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

  it('applies a per-venue watch threshold', async () => {
    const build = (venue: 'binance' | 'okx', nativeId: string, quoteVolume: number) => {
      const item = makeInstrument({
        venue,
        kind: 'perp',
        nativeId,
        base: 'BTC',
        quote: 'USDT',
        velaSymbol: `${venue.toUpperCase()}:${nativeId}`,
      });
      const hub = {
        getInstruments: async () => [item],
        getTickers: async () => [
          {
            instrument: item,
            last: 1,
            change24h: 0,
            quoteVolume,
            funding: null,
            nextFunding: null,
          },
        ],
        getSeries: async () => bars(),
      } as unknown as VenueHub;
      return hub;
    };
    const service = new ScreenerService({
      hubs: new Map<VenueId, VenueHub>([
        ['binance', build('binance', 'BTCUSDT', 2_000_000)],
        ['okx', build('okx', 'BTC-USDT-SWAP', 500_000)],
      ]),
      streams: new Map(),
      config: { minVolumeByVenue: { okx: 100_000 } },
    });

    await service.poll();
    await settle();
    // OKX clears its own lower threshold; Binance keeps the default.
    expect(service.snapshot().rows.map((row) => row.instrument.venue).sort()).toEqual([
      'binance',
      'okx',
    ]);

    // Raising a venue threshold drops its watched row without waiting for a poll.
    service.setConfig({ minVolumeByVenue: { okx: 1_000_000 } });
    expect(service.snapshot().rows.map((row) => row.instrument.venue)).toEqual(['binance']);
    service.stop();
  });

  it('rejects a per-venue threshold for an unknown venue', () => {
    const { hub } = fakeHub();
    const service = new ScreenerService({
      hubs: new Map([['binance', hub]]),
      streams: new Map(),
      config: {},
    });
    expect(() =>
      service.setConfig({
        minVolumeByVenue: { notAVenue: 5 } as unknown as Partial<Record<VenueId, number>>,
      }),
    ).toThrow(/unknown venue/);
    service.stop();
  });
});
