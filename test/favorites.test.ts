import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAVORITE_LIST_ID,
  activeFavoriteList,
  addFavoriteList,
  clearFavoriteList,
  defaultFavoritesState,
  deleteFavoriteList,
  isFavoritesState,
  mergeFavoritesIntoActiveList,
  migrateDefaultFavoriteName,
  parseFavoritesFile,
  renameFavoriteList,
  selectFavoriteList,
  serializeFavorites,
  toggleFavoriteInActiveList,
} from '../src/lib/favorites';

describe('favorite lists', () => {
  it('starts with an empty default list', () => {
    const state = defaultFavoritesState();

    expect(state.activeListId).toBe(DEFAULT_FAVORITE_LIST_ID);
    expect(state.lists).toHaveLength(1);
    expect(activeFavoriteList(state).name).toBe('Default');
    expect(activeFavoriteList(state).items).toEqual([]);
    expect(isFavoritesState(state)).toBe(true);
  });

  it('folds legacy items into the default list', () => {
    const state = defaultFavoritesState(['BTCUSDT', 'okx:BTC-USDT-SWAP']);

    expect(activeFavoriteList(state).items).toEqual([
      'binance:perp:BTCUSDT',
      'okx:perp:BTC-USDT-SWAP',
    ]);
  });

  it('never deletes the default list but deletes others and reselects default', () => {
    const withList = addFavoriteList(defaultFavoritesState(), 'Majors');
    const created = withList.lists[1]!;
    expect(withList.activeListId).toBe(created.id);

    const afterDelete = deleteFavoriteList(withList, created.id);
    expect(afterDelete.lists.map((list) => list.id)).toEqual([
      DEFAULT_FAVORITE_LIST_ID,
    ]);
    expect(afterDelete.activeListId).toBe(DEFAULT_FAVORITE_LIST_ID);
    expect(deleteFavoriteList(afterDelete, DEFAULT_FAVORITE_LIST_ID)).toBe(
      afterDelete,
    );
  });

  it('adds and removes tickers in the active list only', () => {
    const base = addFavoriteList(defaultFavoritesState(), 'Majors');
    const majors = base.lists[1]!;

    const added = toggleFavoriteInActiveList(base, 'okx:perp:BTC-USDT-SWAP');
    expect(activeFavoriteList(added).items).toEqual(['okx:perp:BTC-USDT-SWAP']);
    expect(added.lists[0]!.items).toHaveLength(0);

    const removed = toggleFavoriteInActiveList(added, 'okx:perp:BTC-USDT-SWAP');
    expect(activeFavoriteList(removed).items).toEqual([]);
    expect(activeFavoriteList(removed).id).toBe(majors.id);
  });

  it('renames the old default list once, keeping custom names', () => {
    const state = defaultFavoritesState();
    const legacy = {
      ...state,
      lists: [{ ...state.lists[0]!, name: 'Favorites' }],
    };
    const migrated = migrateDefaultFavoriteName(legacy);
    expect(migrated.lists[0]!.name).toBe('Default');

    const custom = {
      ...state,
      lists: [{ ...state.lists[0]!, name: 'Swing' }],
    };
    expect(migrateDefaultFavoriteName(custom)).toBe(custom);
  });

  it('clears a list without deleting it', () => {
    const base = addFavoriteList(defaultFavoritesState(), 'Majors');
    const withItem = toggleFavoriteInActiveList(base, 'okx:perp:BTC-USDT-SWAP');
    const cleared = clearFavoriteList(withItem, withItem.activeListId);

    expect(activeFavoriteList(cleared).name).toBe('Majors');
    expect(activeFavoriteList(cleared).items).toEqual([]);
    expect(cleared.lists).toHaveLength(2);
    expect(clearFavoriteList(cleared, 'missing')).toBe(cleared);
  });

  it('selects lists and keeps names unique across rename and create', () => {
    const base = addFavoriteList(defaultFavoritesState(), 'Majors');
    const second = addFavoriteList(base, 'majors');
    expect(second.lists.map((list) => list.name)).toEqual([
      'Default',
      'Majors',
      'majors (2)',
    ]);

    const renamed = renameFavoriteList(second, second.lists[1]!.id, 'default');
    expect(renamed.lists.map((list) => list.name)).toEqual([
      'Default',
      'default (2)',
      'majors (2)',
    ]);

    const selected = selectFavoriteList(renamed, second.lists[2]!.id);
    expect(selected.activeListId).toBe(second.lists[2]!.id);
    expect(selectFavoriteList(selected, 'missing')).toBe(selected);
  });
});

describe('favorites import and export', () => {
  it('parses a v2 bundle and dedupes tickers', () => {
    const parsed = parseFavoritesFile(
      JSON.stringify({
        version: 2,
        activeListId: 'default',
        lists: [
          { id: 'default', name: 'Favorites', items: ['BTCUSDT', 'BTCUSDT'] },
          {
            id: 'x',
            name: 'Majors',
            items: ['okx:BTC-USDT-SWAP', 'nope:foo', '!!!'],
          },
        ],
      }),
    );
    expect(parsed.lists).toEqual([
      { name: 'Favorites', items: ['binance:perp:BTCUSDT'] },
      { name: 'Majors', items: ['okx:perp:BTC-USDT-SWAP'] },
    ]);
    expect(parsed.skipped).toBe(2);
  });

  it('accepts the old favorites JSON, a raw array and plain text', () => {
    expect(parseFavoritesFile('{"favorites":["ETHUSDT","coinbase:BTC-USD"]}').lists).toEqual([
      {
        name: 'Imported favorites',
        items: ['binance:perp:ETHUSDT', 'coinbase:spot:BTC-USD'],
      },
    ]);
    expect(parseFavoritesFile('["solusdt"]').lists[0]!.items).toEqual([
      'binance:perp:SOLUSDT',
    ]);
    expect(
      parseFavoritesFile('# note\nBNBUSDT.P\nbybit:BTCUSDT,hyperliquid:ETH\nunknown:foo').lists[0]!
        .items,
    ).toEqual([
      'binance:perp:BNBUSDT',
      'bybit:perp:BTCUSDT',
      'hyperliquid:perp:ETH',
    ]);
  });

  it('adds imported lists to the active list and ignores file list names', () => {
    const base = addFavoriteList(defaultFavoritesState(), 'Majors');
    const merged = mergeFavoritesIntoActiveList(base, [
      { name: 'Default', items: ['okx:perp:BTC-USDT-SWAP', 'binance:perp:BTCUSDT'] },
      { name: 'Other', items: ['bybit:perp:BTCUSDT'] },
    ]);

    expect(merged.lists.map((list) => list.name)).toEqual(['Default', 'Majors']);
    expect(merged.lists[0]!.id).toBe(DEFAULT_FAVORITE_LIST_ID);
    expect(merged.lists[0]!.items).toEqual([]);
    expect(activeFavoriteList(merged).items).toEqual([
      'okx:perp:BTC-USDT-SWAP',
      'binance:perp:BTCUSDT',
      'bybit:perp:BTCUSDT',
    ]);
  });

  it('flattens an exported bundle into the active list', () => {
    const withMajors = toggleFavoriteInActiveList(
      addFavoriteList(defaultFavoritesState(), 'Majors'),
      'bybit:perp:BTCUSDT',
    );
    const parsed = parseFavoritesFile(serializeFavorites(withMajors));
    const merged = mergeFavoritesIntoActiveList(
      defaultFavoritesState(),
      parsed.lists,
    );

    expect(merged.lists).toHaveLength(1);
    expect(merged.lists[0]!.name).toBe('Default');
    expect(merged.lists[0]!.items).toEqual(['bybit:perp:BTCUSDT']);
  });

  it('rejects a JSON document without lists or favorites', () => {
    expect(parseFavoritesFile('{"hello":"world"}')).toEqual({
      lists: [],
      skipped: 1,
    });
  });
});
