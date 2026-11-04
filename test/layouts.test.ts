import { describe, expect, it } from 'vitest';
import {
  LAYOUTS_KEY,
  createLayout,
  duplicateLayout,
  isLayoutLibrary,
  layoutsJson,
  parseLayoutsFile,
  persistLayouts,
  readLayouts,
  uniqueLayoutName,
  updateLayout,
  type LayoutItem,
} from '../src/lib/layouts';

const state = { version: 1, layout: '4', charts: [] };

function item(over: Partial<LayoutItem> = {}): LayoutItem {
  return {
    id: 'layout-a',
    name: 'BTC 2x2',
    createdAt: 1,
    updatedAt: 1,
    symbol: 'BINANCE:BTCUSDT.P',
    timeframe: '1h',
    altSymbol: 'ETHUSDT',
    layout: '4',
    state,
    ...over,
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('layout store', () => {
  it('validates a library and drops malformed documents', () => {
    expect(isLayoutLibrary({ version: 1, items: [item()] })).toBe(true);
    expect(isLayoutLibrary({ version: 2, items: [item()] })).toBe(false);
    expect(isLayoutLibrary({ version: 1, items: [item({ layout: '' })] })).toBe(false);
    expect(isLayoutLibrary({ version: 1, items: [item({ state: { version: 2 } as never })] })).toBe(
      false,
    );
  });

  it('names layouts case-insensitively and leaves the renamed item alone', () => {
    const items = [item({ id: 'a', name: 'BTC scalp' }), item({ id: 'b', name: 'ETH scalp' })];
    expect(uniqueLayoutName(items, 'btc scalp')).toBe('btc scalp 2');
    expect(uniqueLayoutName(items, 'BTC scalp', 'a')).toBe('BTC scalp');
    expect(uniqueLayoutName(items, '  ')).toBe('Layout');
  });

  it('round-trips through localStorage and reports quota errors', () => {
    const storage = memoryStorage();
    const library = { version: 1 as const, items: [item()] };
    expect(persistLayouts(library, storage)).toBeNull();
    expect(storage.getItem(LAYOUTS_KEY)).not.toBeNull();
    expect(readLayouts(storage)).toEqual(library);

    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(persistLayouts(library, storage)).toContain('full');
  });

  it('keeps only the Vela document and the applied script across updates', () => {
    const created = createLayout(
      ' scalped ',
      {
        symbol: 'BINANCE:BTCUSDT.P',
        timeframe: '15',
        altSymbol: 'ETHUSDT',
        layout: '4',
        state,
      },
      { script: 'indicator("x")', name: 'X', all: false },
    );
    expect(created.name).toBe('scalped');
    expect(created.pine?.name).toBe('X');

    const updated = updateLayout(created, {
      symbol: 'OKX:BTC-USDT-SWAP',
      timeframe: '1h',
      altSymbol: '',
      layout: '2h',
      state: { version: 1, layout: '2h', charts: [] },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('scalped');
    expect(updated.layout).toBe('2h');
    expect(updated.state.layout).toBe('2h');
    expect(updated.pine).toBeUndefined();
  });

  it('duplicates without sharing the state object', () => {
    const source = item();
    const copy = duplicateLayout(source, 'Copy');
    expect(copy.id).not.toBe(source.id);
    expect(copy.state).toEqual(source.state);
    copy.state.layout = '8';
    expect(source.state.layout).toBe('4');
  });
});

describe('layout export and import', () => {
  it('exports the file shape and imports it back with fresh ids', () => {
    const source = item();
    const parsed = parseLayoutsFile(layoutsJson([source]));
    expect(parsed.skipped).toBe(0);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.name).toBe(source.name);
    expect(parsed.items[0]?.id).not.toBe(source.id);
    expect(parsed.items[0]?.state).toEqual(source.state);
  });

  it('accepts a bare layout and a bare array', () => {
    expect(parseLayoutsFile(JSON.stringify(item())).items).toHaveLength(1);
    expect(parseLayoutsFile(JSON.stringify([item(), item({ id: 'b' })])).items).toHaveLength(2);
  });

  it('skips unknown fields-free entries and counts them', () => {
    const text = JSON.stringify({
      version: 1,
      items: [item(), { name: 'No state' }, { ...item({ id: 'b' }), state: { version: 1 } }],
    });
    const parsed = parseLayoutsFile(text);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
  });

  it('returns nothing for broken JSON', () => {
    expect(parseLayoutsFile('{not json')).toEqual({ items: [], skipped: 0 });
    expect(parseLayoutsFile('')).toEqual({ items: [], skipped: 0 });
  });
});
