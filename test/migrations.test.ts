import { describe, expect, it } from 'vitest';
import { runMigrations, type MigrationStorage } from '../src/lib/migrations';
import { VENUE_IDS } from '../src/venues/catalog';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    json<T>(key: string): T {
      return JSON.parse(map.get(key) ?? 'null') as T;
    },
    raw: map,
  };
  return storage satisfies MigrationStorage & { json<T>(key: string): T };
}

const SCHEMA_KEY = 'screener.schemaVersion';

/** The storage shape the released 0.3.0 wrote: spot still lived under `binance`. */
function legacyProfile() {
  return memoryStorage({
    'screener.appVersion': '0.3.0',
    'screener.settings': JSON.stringify({
      minVolume: 5_000_000,
      topN: 100,
      scanTimeframe: '15',
      scanBars: 500,
      refreshSeconds: 5,
      defaultLayout: '1',
    }),
    'screener.favorites.v2': JSON.stringify({
      version: 2,
      activeListId: 'default',
      lists: [{ id: 'default', name: 'Default', items: ['binance:spot:BTCUSDT'] }],
    }),
    'screener.orderflow.v2': JSON.stringify({
      version: 1,
      tab: 'book',
      venues: ['binance:spot', 'okx:perp'],
      symbols: { 'BINANCE:BTCUSDT': { venues: ['binance:spot'], grouping: 10 } },
    }),
    'screener.alerts.rules.v1': JSON.stringify([
      {
        kind: 'price',
        id: 'r1',
        target: {
          kind: 'instrument',
          venue: 'binance',
          velaSymbol: 'BINANCE:BTCUSDT',
          symbol: 'BTCUSDT',
        },
      },
    ]),
    'screener.tabs': JSON.stringify([
      { id: 'main', symbol: 'BINANCE:BTCUSDT', altSymbol: 'BINANCE:BTCUSDT.P' },
    ]),
    'screener.alerts.log.v1': JSON.stringify({
      version: 1,
      events: [
        {
          id: 'evt-spot',
          kind: 'rule',
          venue: 'binance',
          velaSymbol: 'BINANCE:BTCUSDT',
          symbol: 'BTCUSDT',
          source: 'PrecSniper',
          message: 'Long',
          time: 1,
        },
        {
          id: 'evt-okx',
          kind: 'rule',
          venue: 'okx',
          velaSymbol: 'OKX:BTC-USDT-SWAP',
          symbol: 'BTC-USDT-SWAP',
          source: 'PrecSniper',
          message: 'Long',
          time: 2,
        },
      ],
      lastReadAt: 0,
      clearedAt: 0,
    }),
    'screener.layouts.v1': JSON.stringify({
      version: 1,
      items: [
        {
          id: 'l1',
          name: 'Spot',
          symbol: 'BINANCE:BTCUSDT',
          altSymbol: 'BINANCE:ETHUSDT.P',
          state: {
            version: 1,
            layout: '1',
            charts: [{ id: 'c1', symbol: 'BINANCE:BTCUSDT' }],
          },
        },
      ],
    }),
    'screener-v2:ws:main': JSON.stringify({
      version: 1,
      layout: '1',
      charts: [
        {
          id: 'c1',
          symbol: 'BINANCE:BTCUSDT',
          ext: { 'screener.scale': { symbol: 'BINANCE:BTCUSDT', timeframe: '15', bars: 200 } },
        },
      ],
    }),
  });
}

describe('storage migrations', () => {
  it('stamps a fresh store with the latest schema', () => {
    const storage = memoryStorage();
    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 0, to: 1, applied: [1], status: 'upgraded' });
    expect(storage.getItem(SCHEMA_KEY)).toBe('1');
  });

  it('is a no-op once the store matches the latest schema', () => {
    const storage = memoryStorage({ [SCHEMA_KEY]: '1' });
    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 1, to: 1, applied: [], status: 'current' });
    expect(storage.raw.size).toBe(1);
  });

  it('ignores the legacy app version key', () => {
    const storage = memoryStorage({
      'screener.appVersion': '0.2.0',
      [SCHEMA_KEY]: '1',
    });
    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 1, to: 1, applied: [], status: 'current' });
    expect(storage.getItem('screener.appVersion')).toBe('0.2.0');
  });

  it('moves Binance spot data and per-venue thresholds from the 0.3.0 schema', () => {
    const storage = legacyProfile();

    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 0, to: 1, applied: [1], status: 'upgraded' });
    expect(storage.getItem(SCHEMA_KEY)).toBe('1');

    const settings = storage.json<{ minVolumeByVenue: Record<string, number>; minVolume?: unknown }>(
      'screener.settings',
    );
    expect(settings.minVolume).toBeUndefined();
    for (const venue of VENUE_IDS) expect(settings.minVolumeByVenue[venue]).toBe(5_000_000);

    const favorites = storage.json<{ lists: Array<{ items: string[] }> }>('screener.favorites.v2');
    expect(favorites.lists[0]!.items).toEqual(['binance_spot:spot:BTCUSDT']);

    const orderflow = storage.json<{
      venues: string[];
      symbols: Record<string, { venues: string[]; grouping: number }>;
    }>('screener.orderflow.v2');
    expect(orderflow.venues).toEqual(['binance_spot:spot', 'okx:perp']);
    expect(orderflow.symbols['BINANCE.SPOT:BTCUSDT']!.venues).toEqual(['binance_spot:spot']);
    expect(orderflow.symbols['BINANCE:BTCUSDT']).toBeUndefined();

    const rules = storage.json<Array<{ target: { venue: string; velaSymbol: string } }>>(
      'screener.alerts.rules.v1',
    );
    expect(rules[0]!.target).toMatchObject({
      venue: 'binance_spot',
      velaSymbol: 'BINANCE.SPOT:BTCUSDT',
    });

    const tabs = storage.json<Array<{ symbol: string; altSymbol: string }>>('screener.tabs');
    expect(tabs[0]).toMatchObject({
      symbol: 'BINANCE.SPOT:BTCUSDT',
      altSymbol: 'BINANCE:BTCUSDT.P',
    });

    const layouts = storage.json<{
      items: Array<{
        symbol: string;
        altSymbol: string;
        state: { charts: Array<{ symbol: string }> };
      }>;
    }>('screener.layouts.v1');
    expect(layouts.items[0]!.symbol).toBe('BINANCE.SPOT:BTCUSDT');
    expect(layouts.items[0]!.altSymbol).toBe('BINANCE:ETHUSDT.P');
    expect(layouts.items[0]!.state.charts[0]!.symbol).toBe('BINANCE.SPOT:BTCUSDT');

    const workspace = storage.json<{
      charts: Array<{ symbol: string; ext: { 'screener.scale': { symbol: string } } }>;
    }>('screener-v2:ws:main');
    expect(workspace.charts[0]!.symbol).toBe('BINANCE.SPOT:BTCUSDT');
    expect(workspace.charts[0]!.ext['screener.scale'].symbol).toBe('BINANCE.SPOT:BTCUSDT');

    const log = storage.json<{
      events: Array<{ id: string; venue?: string; velaSymbol?: string }>;
    }>('screener.alerts.log.v1');
    expect(log.events[0]).toMatchObject({
      id: 'evt-spot',
      venue: 'binance_spot',
      velaSymbol: 'BINANCE.SPOT:BTCUSDT',
    });
    expect(log.events[1]).toMatchObject({
      id: 'evt-okx',
      venue: 'okx',
      velaSymbol: 'OKX:BTC-USDT-SWAP',
    });
  });

  it('leaves current-schema data alone when the revision is re-run', () => {
    // Dev builds that ran the spot split under the old app-version key are on
    // schema 0 with current data; the step must be a no-op for them.
    const storage = memoryStorage({
      [SCHEMA_KEY]: '0',
      'screener.settings': JSON.stringify({
        minVolumeByVenue: Object.fromEntries(VENUE_IDS.map((venue) => [venue, 1_000_000])),
        topN: 100,
        scanTimeframe: '15',
        scanBars: 500,
        refreshSeconds: 5,
        defaultLayout: '1',
      }),
      'screener.favorites.v2': JSON.stringify({
        version: 2,
        activeListId: 'default',
        lists: [{ id: 'default', name: 'Default', items: ['binance_spot:spot:BTCUSDT'] }],
      }),
      'screener.orderflow.v2': JSON.stringify({
        version: 1,
        tab: 'book',
        venues: ['binance_spot:spot', 'binance:perp'],
        symbols: { 'BINANCE.SPOT:BTCUSDT': { venues: ['binance_spot:spot'], grouping: 10 } },
      }),
      'screener.tabs': JSON.stringify([
        { id: 'main', symbol: 'BINANCE.SPOT:BTCUSDT', altSymbol: 'BINANCE:ETHUSDT.P' },
      ]),
      'screener-v2:ws:main': JSON.stringify({
        version: 1,
        layout: '1',
        charts: [
          {
            id: 'main',
            provider: 'binance.spot',
            symbol: 'BINANCE.SPOT:BTCUSDT',
            ext: {
              'screener.scale': {
                symbol: 'BINANCE.SPOT:BTCUSDT',
                timeframe: '15',
                bars: 300,
              },
            },
          },
        ],
      }),
    });
    const keys = [...storage.raw.keys()].filter((key) => key !== SCHEMA_KEY);
    const before = new Map(keys.map((key) => [key, storage.getItem(key)]));

    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 0, to: 1, applied: [1], status: 'upgraded' });
    for (const key of keys) expect(storage.getItem(key)).toBe(before.get(key));
    expect(storage.getItem(SCHEMA_KEY)).toBe('1');
  });

  it('never rewrites a store from a newer schema', () => {
    const storage = memoryStorage({
      [SCHEMA_KEY]: '2',
      'screener.settings': JSON.stringify({ minVolume: 5_000_000 }),
    });
    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 2, to: 2, applied: [], status: 'newer' });
    expect(storage.json<{ minVolume: number }>('screener.settings').minVolume).toBe(5_000_000);
    expect(storage.getItem(SCHEMA_KEY)).toBe('2');
  });

  it('reads a malformed schema as revision 0', () => {
    const storage = memoryStorage({
      [SCHEMA_KEY]: 'nope',
      'screener.tabs': JSON.stringify([{ id: 'main', symbol: 'BINANCE:BTCUSDT' }]),
    });
    const report = runMigrations(storage);
    expect(report).toMatchObject({ from: 0, to: 1, status: 'upgraded' });
    expect(storage.json<Array<{ symbol: string }>>('screener.tabs')[0]!.symbol).toBe(
      'BINANCE.SPOT:BTCUSDT',
    );
    expect(storage.getItem(SCHEMA_KEY)).toBe('1');
  });

  it('stops a failing run at the last completed revision', () => {
    const storage = memoryStorage();
    const report = runMigrations(storage, {
      steps: [
        { schema: 1, run: (target) => target.setItem('first', 'ok') },
        {
          schema: 2,
          run: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(report).toMatchObject({
      status: 'failed',
      to: 1,
      applied: [1],
      error: 'boom',
    });
    expect(storage.getItem(SCHEMA_KEY)).toBe('1');
    expect(storage.getItem('first')).toBe('ok');
  });

  it('rolls a failing migration back', () => {
    const storage = memoryStorage({
      'screener.favorites.v2': JSON.stringify({ version: 2, activeListId: 'a', lists: [] }),
    });
    const before = storage.getItem('screener.favorites.v2');
    const report = runMigrations(storage, {
      steps: [
        {
          schema: 1,
          run: (target) => {
            target.setItem('screener.settings', '{"minVolume":1}');
            target.removeItem('screener.favorites.v2');
            throw new Error('boom');
          },
        },
      ],
    });
    expect(report).toMatchObject({ status: 'failed', to: 0, applied: [], error: 'boom' });
    expect(storage.getItem('screener.settings')).toBeNull();
    expect(storage.getItem('screener.favorites.v2')).toBe(before);
    expect(storage.getItem(SCHEMA_KEY)).toBeNull();
  });

  it('leaves malformed JSON alone and still finishes', () => {
    const storage = memoryStorage({
      'screener.settings': '{not json',
      'screener.tabs': JSON.stringify([{ id: 'main', symbol: 'BINANCE:BTCUSDT' }]),
    });
    const report = runMigrations(storage);
    expect(report.status).toBe('upgraded');
    expect(storage.getItem('screener.settings')).toBe('{not json');
    expect(storage.json<Array<{ symbol: string }>>('screener.tabs')[0]!.symbol).toBe(
      'BINANCE.SPOT:BTCUSDT',
    );
  });
});
