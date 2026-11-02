import { describe, expect, it } from 'vitest';
import {
  instrumentKey,
  makeInstrument,
  perpDisplay,
  spotDisplay,
} from '../src/venues/instrument';
import { FakeVenueAdapter } from '../src/venues/fake';
import { klineToBar } from '../sidecar/stream';
import { VenueRegistry } from '../src/venues/registry';
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

  it('rejects unknown venues', () => {
    expect(() => new VenueRegistry().require('missing')).toThrow('Unknown venue');
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
    expect(clock.time).toBe(1001);
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
    expect(clock.time).toBe(60_001);
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
