import { describe, expect, it, vi } from 'vitest';
import {
  instrumentKey,
  makeInstrument,
  perpDisplay,
  sameVelaSymbol,
  spotDisplay,
} from '../src/venues/instrument';
import { FakeVenueAdapter } from '../src/venues/fake';
import { parseOkxFunding, okxErrorInfo } from '../src/venues/okx';
import { klineToBar } from '../sidecar/stream';
import { VenueRegistry } from '../src/venues/registry';
import { hyperliquidWeight } from '../src/venues/hyperliquid';
import type { VenueAdapter, VenueBar } from '../src/venues/types';
import { VenueHub } from '../sidecar/hub';
import {
  RateLimiter,
  VenueRateLimitError,
  type RateLimitClock,
} from '../src/venues/rateLimit';

describe('instrument naming', () => {
  it('uses .P for perps and keeps the spot separator rule', () => {
    expect(perpDisplay('BTC', 'USDT')).toBe('BTCUSDT.P');
    expect(spotDisplay('BTCUSDT', 'BTC', 'USDT')).toBe('BTCUSDT');
    expect(spotDisplay('BTC/USD', 'BTC', 'USD')).toBe('BTC/USD');
    expect(spotDisplay('BTC-USD', 'BTC', 'USD')).toBe('BTCUSD');

    const perp = makeInstrument({
      venue: 'binance',
      nativeId: 'BTCUSDT',
      base: 'BTC',
      quote: 'USDT',
      kind: 'perp',
      velaSymbol: 'BINANCE:BTCUSDT.P',
    });
    expect(perp.key).toBe(instrumentKey('binance', 'perp', 'BTCUSDT'));
    expect(perp.display).toBe('BTCUSDT.P');
    expect(perp.velaSymbol).toBe('BINANCE:BTCUSDT.P');
  });

  it('keeps the venue tick size for syminfo.mintick', () => {
    const perp = makeInstrument({
      venue: 'binance',
      nativeId: 'BTCUSDT',
      base: 'BTC',
      quote: 'USDT',
      kind: 'perp',
      velaSymbol: 'BINANCE:BTCUSDT.P',
      pricePrecision: 2,
      tickSize: 0.1,
    });
    expect(perp.tickSize).toBe(0.1);
  });

  it('compares bare, prefixed and perp chart symbols', () => {
    expect(sameVelaSymbol('BTCUSDT', 'BINANCE:BTCUSDT.P')).toBe(true);
    expect(sameVelaSymbol('binance:BTCUSDT', 'BINANCE:BTCUSDT.P')).toBe(true);
    expect(sameVelaSymbol('okx:BTC-USDT-SWAP', 'OKX:BTC-USDT-SWAP')).toBe(true);
    expect(sameVelaSymbol('okx:BTC-USDT-SWAP', 'bybit:BTCUSDT')).toBe(false);
    expect(sameVelaSymbol('ETHUSDT', 'BTCUSDT')).toBe(false);
  });
});

describe('venue adapter contract', () => {
  it('normalizes a streamed Binance kline into a venue bar', () => {
    expect(
      klineToBar({ t: 1000, T: 2000, o: '1', h: '2', l: '0.5', c: '1.5', v: '10' }),
    ).toEqual({
      openTime: 1000,
      closeTime: 2000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    });
  });

  it('normalizes the fake venue and registers it', async () => {
    const adapter = new FakeVenueAdapter();
    const registry = new VenueRegistry();
    registry.register(adapter);

    expect(registry.require('fake')).toBe(adapter);
    expect(registry.list().map((item) => item.id)).toEqual(['fake']);

    const instruments = await adapter.listInstruments();
    expect(instruments.map((item) => item.display)).toEqual(['BTCUSDT.P', 'BTC/USD']);

    const tickers = await adapter.fetchTickers();
    expect(tickers).toHaveLength(2);
    expect(tickers[0]?.instrument.kind).toBe('perp');

    const bars = await adapter.fetchBars(instruments[0]!, '15', 300);
    expect(bars).toHaveLength(300);
    expect(bars[0]!.openTime).toBeLessThan(bars[299]!.openTime);
  });

  it('parses OKX funding-rate frames and skips acks', () => {
    const frame = JSON.stringify({
      arg: { channel: 'funding-rate', instId: 'BTC-USDT-SWAP' },
      data: [
        {
          instId: 'BTC-USDT-SWAP',
          fundingRate: '0.0001000000000000',
          nextFundingTime: '1793664000000',
        },
      ],
    });
    expect(parseOkxFunding(frame)).toEqual([
      { instId: 'BTC-USDT-SWAP', funding: 0.0001, nextFunding: 1793664000000 },
    ]);
    expect(
      parseOkxFunding(
        JSON.stringify({ event: 'subscribe', arg: { channel: 'funding-rate' } }),
      ),
    ).toEqual([]);
  });

  it('rejects unknown venues', () => {
    expect(() => new VenueRegistry().require('missing')).toThrow('Unknown venue');
  });
});

describe('OKX API errors', () => {
  it('recognizes plain-object rate-limit and transient codes', () => {
    const rate = okxErrorInfo({ code: '50011', msg: 'Too many requests' });
    expect(rate.code).toBe('50011');
    expect(rate.rateLimited).toBe(true);
    expect(rate.transient).toBe(false);

    const busy = okxErrorInfo({ code: '50013', msg: 'Systems are busy' });
    expect(busy.rateLimited).toBe(false);
    expect(busy.transient).toBe(true);
  });

  it('recognizes string errors and leaves business errors alone', () => {
    expect(okxErrorInfo(new Error('50011 rate limit')).rateLimited).toBe(true);
    expect(
      okxErrorInfo({ code: '51001', msg: 'Instrument ID does not exist' }),
    ).toMatchObject({ code: '51001', rateLimited: false, transient: false });
  });
});

class FakeClock implements RateLimitClock {
  time = 0;

  now(): number {
    return this.time;
  }

  async sleep(ms: number): Promise<void> {
    this.time += ms;
  }
}

/** Time only moves when the test advances it, so concurrent grants can be ordered. */
class ManualClock implements RateLimitClock {
  time = 0;
  private waiters: Array<{ at: number; resolve: () => void }> = [];

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push({ at: this.time + ms, resolve });
    });
  }

  advance(ms: number): void {
    this.time += ms;
    for (const waiter of [...this.waiters]) {
      if (waiter.at <= this.time) {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        waiter.resolve();
      }
    }
  }
}

describe('rate limiter', () => {
  it('paces requests through a window', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 1,
        buckets: [{ id: 'requests', type: 'requests', limit: 1, windowMs: 1000 }],
      },
      clock,
    );

    await limiter.run({ bucket: 'requests' }, async () => undefined);
    await limiter.run({ bucket: 'requests' }, async () => undefined);
    expect(clock.time).toBe(1000);
  });

  it('accounts for request weight', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 2,
        buckets: [{ id: 'weight', type: 'weight', limit: 5, windowMs: 60_000 }],
      },
      clock,
    );

    await limiter.run({ bucket: 'weight', cost: 3 }, async () => undefined);
    await limiter.run({ bucket: 'weight', cost: 3 }, async () => undefined);
    expect(clock.time).toBe(12_000);
  });

  it('bursts up to the limit and then paces evenly', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 4,
        buckets: [{ id: 'requests', type: 'requests', limit: 20, windowMs: 2_000 }],
      },
      clock,
    );

    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 21 }, () =>
        limiter.run({ bucket: 'requests' }, async () => {
          starts.push(clock.time);
        }),
      ),
    );
    expect(starts.filter((time) => time === 0)).toHaveLength(20);
    expect(Math.max(...starts)).toBe(100);
  });

  it('does not hold a slot while waiting for a bucket', async () => {
    const clock = new ManualClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 1,
        buckets: [
          { id: 'market', type: 'requests', limit: 1, windowMs: 1_000 },
          { id: 'candles', type: 'requests', limit: 1, windowMs: 1_000 },
        ],
      },
      clock,
    );

    const order: string[] = [];
    await limiter.run({ bucket: 'candles' }, async () => {
      order.push('candles-1');
    });
    const slow = limiter.run({ bucket: 'candles' }, async () => {
      order.push('candles-2');
    });
    await limiter.run({ bucket: 'market' }, async () => {
      order.push('market');
    });
    expect(order).toEqual(['candles-1', 'market']);
    clock.advance(1_000);
    await slow;
    expect(order).toEqual(['candles-1', 'market', 'candles-2']);
    expect(clock.time).toBe(1_000);
  });

  it('grants interactive work before background work', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 1,
        buckets: [{ id: 'requests', type: 'requests', limit: 1, windowMs: 1_000 }],
      },
      clock,
    );

    const order: string[] = [];
    let releaseFirst!: () => void;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = limiter.run({ bucket: 'requests' }, async () => {
      started();
      await gate;
    });
    await firstStarted;
    const background = limiter.run(
      { bucket: 'requests', priority: 'background' },
      async () => {
        order.push('background');
      },
    );
    const interactive = limiter.run(
      { bucket: 'requests', priority: 'interactive' },
      async () => {
        order.push('interactive');
      },
    );
    releaseFirst();
    await first;
    await Promise.all([background, interactive]);
    expect(order).toEqual(['interactive', 'background']);
  });

  it('does not run an aborted queued request', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 1,
        buckets: [{ id: 'requests', type: 'requests', limit: 1, windowMs: 1_000 }],
      },
      clock,
    );
    await limiter.run({ bucket: 'requests' }, async () => undefined);

    const controller = new AbortController();
    let ran = false;
    const pending = limiter.run(
      { bucket: 'requests', signal: controller.signal },
      async () => {
        ran = true;
      },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(ran).toBe(false);
  });

  it('uses the Hyperliquid info weights', () => {
    expect(hyperliquidWeight('meta')).toBe(20);
    expect(hyperliquidWeight('metaAndAssetCtxs')).toBe(20);
    expect(hyperliquidWeight('candleSnapshot')).toBe(20);
    expect(hyperliquidWeight('candleSnapshot', 500)).toBe(28);
    expect(hyperliquidWeight('candleSnapshot', 5000)).toBe(103);
  });

  it('honors pauses and bans', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(
      {
        maxConcurrent: 1,
        buckets: [{ id: 'requests', type: 'requests', limit: 10, windowMs: 1000 }],
      },
      clock,
    );

    limiter.pauseFor(500);
    await limiter.run({ bucket: 'requests' }, async () => undefined);
    expect(clock.time).toBe(500);

    limiter.banFor(1000);
    await expect(limiter.run({ bucket: 'requests' }, async () => undefined)).rejects.toBeInstanceOf(
      VenueRateLimitError,
    );
    expect(limiter.banRemainingMs).toBe(1000);

    clock.time += 1000;
    await limiter.run({ bucket: 'requests' }, async () => undefined);
    expect(limiter.banRemainingMs).toBe(0);
  });

  it('rejects unknown buckets and invalid policies', async () => {
    const limiter = new RateLimiter({
      maxConcurrent: 1,
      buckets: [{ id: 'requests', type: 'requests', limit: 1, windowMs: 1000 }],
    });
    await expect(limiter.run({ bucket: 'missing' }, async () => undefined)).rejects.toThrow(
      'Unknown rate limit bucket',
    );
    expect(
      () =>
        new RateLimiter({
          maxConcurrent: 0,
          buckets: [{ id: 'requests', type: 'requests', limit: 1, windowMs: 1000 }],
        }),
    ).toThrow('maxConcurrent');
  });
});

describe('venue hub', () => {
  const instrument = makeInstrument({
    venue: 'binance',
    nativeId: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    kind: 'perp',
    velaSymbol: 'BINANCE:BTCUSDT.P',
  });

  function stubAdapter(): {
    adapter: VenueAdapter;
    calls: () => number;
    signal: () => AbortSignal | undefined;
    resolve: (bars: VenueBar[]) => void;
  } {
    let calls = 0;
    let upstreamSignal: AbortSignal | undefined;
    let resolveBars: ((bars: VenueBar[]) => void) | null = null;
    const adapter = {
      fetchBars: (
        _instrument: unknown,
        _timeframe: unknown,
        _bars: unknown,
        signal?: AbortSignal,
      ): Promise<VenueBar[]> => {
        calls += 1;
        upstreamSignal = signal;
        return new Promise<VenueBar[]>((resolve) => {
          resolveBars = resolve;
        });
      },
    } as unknown as VenueAdapter;
    return {
      adapter,
      calls: () => calls,
      signal: () => upstreamSignal,
      resolve: (bars) => resolveBars?.(bars),
    };
  }

  it('reuses an in-flight bars request beyond the cache TTL', async () => {
    let now = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const stub = stubAdapter();
      const hub = new VenueHub(stub.adapter);
      const first = hub.getBars(instrument, '15', 500);
      now = 3_000;
      const second = hub.getBars(instrument, '15', 500);
      expect(stub.calls()).toBe(1);
      stub.resolve([]);
      await expect(first).resolves.toEqual([]);
      await expect(second).resolves.toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('aborts the upstream request only after every subscriber leaves', () => {
    const stub = stubAdapter();
    const hub = new VenueHub(stub.adapter);
    const first = new AbortController();
    const second = new AbortController();
    hub.getBars(instrument, '15', 500, { signal: first.signal });
    hub.getBars(instrument, '15', 500, { signal: second.signal });
    expect(stub.signal()?.aborted).toBe(false);
    first.abort();
    expect(stub.signal()?.aborted).toBe(false);
    second.abort();
    expect(stub.signal()?.aborted).toBe(true);
  });
});
