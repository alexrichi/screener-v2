import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The alert store renders toasts through sonner; keep the module importable
// and inert in Node.
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, { info: () => {}, warning: () => {} }),
}));

import { parseAlertEvents } from '../src/lib/alertRules';
import {
  addAlertRule,
  alertEvents,
  clearAlertLog,
  pushReplayEvents,
  pushRuleEvents,
} from '../src/lib/alerts';
import { AlertService } from '../sidecar/alerts';
import type { VenueHub } from '../sidecar/hub';
import type { Instrument, VenueBar } from '../src/venues/types';

const INTERVAL = 900_000; // '15' timeframe
const CLOSE_DELAY = 2_500;
const BASE = 1_700_000_000_000;

const SCRIPT = `//@version=6
indicator("probe")
alert("fired")`;

const INSTRUMENT: Instrument = {
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

const ETH: Instrument = {
  ...INSTRUMENT,
  key: 'binance:perp:ETHUSDT',
  nativeId: 'ETHUSDT',
  display: 'ETHUSDT.P',
  velaSymbol: 'BINANCE:ETHUSDT.P',
  base: 'ETH',
};

interface BarsCall {
  instrument: Instrument;
  timeframe: string;
  bars: number;
  opts: Record<string, unknown>;
}

interface StubHub {
  hub: VenueHub;
  calls: () => number;
  barCalls: () => BarsCall[];
  setBars: (bars: VenueBar[]) => void;
  setSeries: (symbol: string, timeframe: string, bars: VenueBar[]) => void;
}

function makeStubHub(instruments: readonly Instrument[] = [INSTRUMENT]): StubHub {
  let bars: VenueBar[] = [];
  let count = 0;
  const calls: BarsCall[] = [];
  const series = new Map<string, VenueBar[]>();
  const hub = {
    getInstruments: async () => [...instruments],
    getBars: async (
      instrument: Instrument,
      timeframe: string,
      requested: number,
      opts: Record<string, unknown> = {},
    ) => {
      count += 1;
      calls.push({ instrument, timeframe, bars: requested, opts });
      return series.get(`${instrument.velaSymbol}@${timeframe}`) ?? bars;
    },
  } as unknown as VenueHub;
  return {
    hub,
    calls: () => count,
    barCalls: () => calls,
    setBars: (next: VenueBar[]) => {
      bars = next;
    },
    setSeries: (symbol: string, timeframe: string, next: VenueBar[]) => {
      series.set(`${symbol}@${timeframe}`, next);
    },
  };
}

function barsUpTo(openTime: number, count = 5, step = INTERVAL): VenueBar[] {
  const out: VenueBar[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const time = openTime - index * step;
    out.push({
      openTime: time,
      closeTime: time + step - 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
    });
  }
  return out;
}

function makeRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'rule-1',
    kind: 'chart',
    name: 'probe',
    target: {
      kind: 'instrument',
      venue: 'binance',
      velaSymbol: 'BINANCE:BTCUSDT.P',
      symbol: 'BTCUSDT.P',
    },
    timeframe: '15',
    script: SCRIPT,
    inputs: {},
    sites: [],
    includeAlert: true,
    frequency: 'once-per-bar-close',
    notify: { toast: false, sound: false, system: false },
    indicatorTitle: 'probe',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    lastFiredAt: null,
    fireCount: 0,
    targets: ['BINANCE:BTCUSDT.P'],
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `rule-1:BINANCE:BTCUSDT.P:${BASE}:fired`,
    kind: 'rule',
    ruleId: 'rule-1',
    venue: 'binance',
    velaSymbol: 'BINANCE:BTCUSDT.P',
    symbol: 'BTCUSDT.P',
    timeframe: '15',
    source: 'probe',
    site: 'fired',
    message: 'fired',
    price: 100.5,
    time: BASE,
    receivedAt: BASE,
    ...overrides,
  };
}

type Frame = {
  op?: string;
  events?: Array<Record<string, unknown>>;
  ruleId?: string;
  message?: string;
  error?: string;
};

function collector(): { frames: Frame[]; send: (payload: unknown) => void } {
  const frames: Frame[] = [];
  return { frames, send: (payload) => frames.push(payload as Frame) };
}

function liveEvents(frames: readonly Frame[]): Array<Record<string, unknown>> {
  return frames
    .filter((frame) => frame.op === 'alerts.event')
    .flatMap((frame) => frame.events ?? []);
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'screener-alerts-'));
const services: AlertService[] = [];
let tmpFile = '';

beforeEach(() => {
  tmpFile = path.join(
    tmpDir,
    `alerts-${services.length}-${Math.random().toString(36).slice(2)}.json`,
  );
  process.env.ALERTS_FILE = tmpFile;
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
  rmSync(tmpFile, { force: true });
  delete process.env.ALERTS_FILE;
});

function newService(stub: StubHub): AlertService {
  const service = new AlertService({ hubs: new Map([['binance', stub.hub]]) });
  services.push(service);
  return service;
}

describe('parseAlertEvents limits', () => {
  it('keeps 100 for live frames and honors the disk cap', () => {
    const events = Array.from({ length: 250 }, (_, index) =>
      makeEvent({ id: `e${index}`, receivedAt: BASE + index }),
    );
    expect(parseAlertEvents(events)).toHaveLength(100);
    expect(parseAlertEvents(events, 500)).toHaveLength(250);
    expect(parseAlertEvents(events, 500)[249]).toMatchObject({ id: 'e249' });
  });
});

describe('AlertService persistence', () => {
  it('replays every stored event through the file cap', () => {
    const events = Array.from({ length: 200 }, (_, index) =>
      makeEvent({ id: `e${index}`, receivedAt: BASE + index }),
    );
    writeFileSync(tmpFile, JSON.stringify({ version: 1, rules: [], events }));
    const service = newService(makeStubHub());
    const { frames, send } = collector();
    service.subscribe(send);
    const replay = frames.find((frame) => frame.op === 'alerts.replay');
    expect(replay?.events ?? []).toHaveLength(200);
  });
});

describe('alert log watermark', () => {
  it('drops replayed events that were cleared and keeps newer ones', () => {
    addAlertRule(makeRule());
    pushRuleEvents([makeEvent({ id: 'seen-1', receivedAt: BASE - 10_000 })]);
    expect(alertEvents()).toHaveLength(1);

    clearAlertLog();
    expect(alertEvents()).toHaveLength(0);

    expect(pushReplayEvents([makeEvent({ id: 'seen-1', receivedAt: BASE - 10_000 })])).toBe(0);
    expect(alertEvents()).toHaveLength(0);

    expect(pushReplayEvents([makeEvent({ id: 'fresh-1', receivedAt: BASE + 10_000 })])).toBe(1);
    expect(alertEvents()).toHaveLength(1);
  });
});

describe('once rules', () => {
  it('retires on disk and a stale renderer copy cannot resurrect it', async () => {
    const stub = makeStubHub();
    stub.setBars(barsUpTo(BASE));
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([makeRule({ id: 'once-1', frequency: 'once', updatedAt: 1 })]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);
    expect(liveEvents(frames)).toHaveLength(1);

    const stored = JSON.parse(readFileSync(tmpFile, 'utf8')) as {
      rules: Array<{ enabled: boolean; updatedAt: number }>;
    };
    expect(stored.rules[0]!.enabled).toBe(false);
    const retiredAt = stored.rules[0]!.updatedAt;

    // A restart must not re-arm the retired rule.
    const stub2 = makeStubHub();
    const service2 = newService(stub2);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub2.calls()).toBe(0);

    // The first config after a reconnect carries the stale copy; the guard
    // must keep the rule disabled even at an equal updatedAt.
    service2.setRules([
      makeRule({ id: 'once-1', frequency: 'once', enabled: true, updatedAt: retiredAt }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub2.calls()).toBe(0);
  });
});

describe('re-arm between timers', () => {
  it('keeps the bar that closed while the job was away', async () => {
    const stub = makeStubHub();
    stub.setBars(barsUpTo(BASE));
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([makeRule({ id: 're-1' })]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);
    expect(liveEvents(frames)).toHaveLength(1);

    // A reconnect-style resend while the T2 bar is already closed.
    stub.setBars(barsUpTo(BASE + 2 * INTERVAL));
    service.setRules([makeRule({ id: 're-1', updatedAt: 2 })]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);
    expect(liveEvents(frames)).toHaveLength(2);
  });
});

describe('pause and re-enable', () => {
  it('never fires the bar that closed while the rule was paused', async () => {
    const stub = makeStubHub();
    stub.setBars(barsUpTo(BASE));
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([makeRule({ id: 'pe-1' })]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);
    expect(liveEvents(frames)).toHaveLength(1);

    // Pause; the T2 bar closes during the pause.
    service.setRules([makeRule({ id: 'pe-1', enabled: false, updatedAt: 10 })]);
    stub.setBars(barsUpTo(BASE + 2 * INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);

    // Re-enable arms from the latest closed bar, not from lastEvaluated.
    service.setRules([makeRule({ id: 'pe-1', enabled: true, updatedAt: 11 })]);
    await vi.advanceTimersByTimeAsync(0);
    const baseline = stub.calls();

    // The armed timer sits a full interval out; walk past it plus the retry
    // loop, then prove the downtime bar never fired.
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY + 40_000);
    expect(liveEvents(frames)).toHaveLength(1);
    expect(stub.calls()).toBeGreaterThan(baseline);

    // The next close fires normally.
    stub.setBars(barsUpTo(BASE + 3 * INTERVAL));
    await vi.advanceTimersByTimeAsync(5_000);
    const events = liveEvents(frames);
    expect(events).toHaveLength(2);
    expect(events[1]!.time).toBe(BASE + 3 * INTERVAL);
  });
});

describe('request.security series', () => {
  it('fetches a foreign symbol and fires', async () => {
    const stub = makeStubHub([INSTRUMENT, ETH]);
    stub.setBars(barsUpTo(BASE));
    stub.setSeries(ETH.velaSymbol, '15', barsUpTo(BASE + INTERVAL));
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([
      makeRule({
        id: 'foreign-1',
        script: `//@version=6
indicator("probe")
eth = request.security("ETHUSDT", "15", close)
alert("eth " + str.tostring(eth))`,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);

    expect(liveEvents(frames)).toHaveLength(1);
    const call = stub
      .barCalls()
      .find(
        (entry) =>
          entry.instrument.velaSymbol === ETH.velaSymbol && entry.timeframe === '15',
      );
    expect(call).toBeDefined();
    expect(call!.bars).toBeGreaterThanOrEqual(50);
    expect(call!.opts.from).toBe(BASE - 3 * INTERVAL);
    expect(call!.opts.to).toBe(BASE + 2 * INTERVAL);
    expect(frames.filter((frame) => frame.op === 'alerts.warning')).toHaveLength(0);
  });

  it('fetches lower-timeframe bars with the full range', async () => {
    const stub = makeStubHub();
    stub.setBars(barsUpTo(BASE, 1500));
    stub.setSeries(
      INSTRUMENT.velaSymbol,
      '1',
      barsUpTo(BASE + 2 * INTERVAL - 60_000, 300, 60_000),
    );
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([
      makeRule({
        id: 'lower-1',
        script: `//@version=6
indicator("probe")
lows = request.security_lower_tf(syminfo.tickerid, "1", close)
alert("count " + str.tostring(array.size(lows)))`,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL, 1500));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);

    expect(liveEvents(frames)).toHaveLength(1);
    expect(liveEvents(frames)[0]!.message).toBe('count 15');
    const call = stub
      .barCalls()
      .find(
        (entry) =>
          entry.instrument.velaSymbol === INSTRUMENT.velaSymbol && entry.timeframe === '1',
      );
    expect(call).toBeDefined();
    // 1500 × 15m × 1.1 / 1m = 24,750.000…; the runtime's ceil + 20 is 24,771.
    expect(call!.bars).toBe(24_771);
    expect(call!.opts.from).toBe(BASE + INTERVAL - 1499 * INTERVAL);
    expect(call!.opts.to).toBe(BASE + 2 * INTERVAL);
    expect(frames.filter((frame) => frame.op === 'alerts.warning')).toHaveLength(0);
  });
});

describe('request.security warnings', () => {
  it('returns na for an unserved venue without a warning', async () => {
    const stub = makeStubHub();
    stub.setBars(barsUpTo(BASE));
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([
      makeRule({
        id: 'unknown-venue',
        script: `//@version=6
indicator("probe")
es = request.security("CME_MINI:ES1!", "15", close)
alert("es " + str.tostring(es))`,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);

    expect(liveEvents(frames)).toHaveLength(1);
    expect(frames.filter((frame) => frame.op === 'alerts.warning')).toHaveLength(0);
    expect(frames.filter((frame) => frame.op === 'alerts.error')).toHaveLength(0);
  });

  it('warns about a missing series without stopping the rule', async () => {
    const stub = makeStubHub();
    stub.setBars(barsUpTo(BASE));
    const service = newService(stub);
    const { frames, send } = collector();
    service.subscribe(send);

    service.setRules([
      makeRule({
        id: 'warn-1',
        script: `//@version=6
indicator("probe")
missing = request.security("MISSING", "15", close)
alert("missing " + str.tostring(missing))`,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    stub.setBars(barsUpTo(BASE + INTERVAL));
    await vi.advanceTimersByTimeAsync(INTERVAL + CLOSE_DELAY);

    expect(liveEvents(frames)).toHaveLength(1);
    const warnings = frames.filter((frame) => frame.op === 'alerts.warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.ruleId).toBe('warn-1');
    expect(warnings[0]!.message).toContain('MISSING');
    expect(frames.filter((frame) => frame.op === 'alerts.error')).toHaveLength(0);

    const stored = JSON.parse(readFileSync(tmpFile, 'utf8')) as {
      rules: Array<{ enabled: boolean }>;
    };
    expect(stored.rules[0]!.enabled).toBe(true);
  });
});
