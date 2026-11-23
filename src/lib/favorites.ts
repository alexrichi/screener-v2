import { VENUE_IDS } from '../venues/catalog';
import { favoriteKey } from './universe';

export interface FavoriteList {
  id: string;
  name: string;
  items: string[];
}

export interface FavoritesState {
  version: 2;
  lists: FavoriteList[];
  activeListId: string;
}

export interface ParsedFavoriteList {
  name: string;
  items: string[];
}

export interface ParsedFavorites {
  lists: ParsedFavoriteList[];
  skipped: number;
}

export const FAVORITES_STORAGE_KEY = 'screener.favorites.v2';
export const DEFAULT_FAVORITE_LIST_ID = 'default';
export const DEFAULT_FAVORITE_LIST_NAME = 'Default';

const LEGACY_FAVORITES_KEY = 'screener.favorites';
const DEFAULT_NAME_MIGRATION_KEY = 'screener.favorites.default-name.v1';
const IMPORTED_LIST_NAME = 'Imported favorites';
const VENUE_SET = new Set(VENUE_IDS);
const TICKER = /^[A-Z0-9][A-Z0-9._/-]*$/;

function uniqueItems(items: string[]): string[] {
  return [...new Set(items)];
}

function uniqueName(
  lists: FavoriteList[],
  desired: string,
  ignoreId?: string,
): string {
  const base = desired.trim() || DEFAULT_FAVORITE_LIST_NAME;
  const taken = new Set(
    lists
      .filter((list) => list.id !== ignoreId)
      .map((list) => list.name.trim().toLowerCase()),
  );
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  return candidate;
}

let sequence = 0;

function newListId(): string {
  sequence += 1;
  return `fl-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Build the initial default list, folding any legacy single favorites list in. */
export function defaultFavoritesState(legacy: string[] = []): FavoritesState {
  return {
    version: 2,
    lists: [
      {
        id: DEFAULT_FAVORITE_LIST_ID,
        name: DEFAULT_FAVORITE_LIST_NAME,
        items: uniqueItems(
          legacy.map((item) => normalizeItem(item) ?? favoriteKey(item)),
        ),
      },
    ],
    activeListId: DEFAULT_FAVORITE_LIST_ID,
  };
}

/** Read the pre-multi-list favorites key once, for the initial fallback. */
export function initialFavoritesState(): FavoritesState {
  migrateStoredDefaultName();
  try {
    const raw = localStorage.getItem(LEGACY_FAVORITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const legacy = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
    return defaultFavoritesState(legacy);
  } catch {
    return defaultFavoritesState();
  }
}

export function isFavoritesState(value: unknown): value is FavoritesState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<FavoritesState>;
  if (state.version !== 2 || !Array.isArray(state.lists) || state.lists.length === 0) {
    return false;
  }
  const ids = new Set<string>();
  for (const list of state.lists) {
    if (
      typeof list !== 'object' ||
      list === null ||
      typeof list.id !== 'string' ||
      typeof list.name !== 'string' ||
      !Array.isArray(list.items) ||
      !list.items.every((item) => typeof item === 'string')
    ) {
      return false;
    }
    if (ids.has(list.id)) return false;
    ids.add(list.id);
  }
  return typeof state.activeListId === 'string';
}

export function activeFavoriteList(state: FavoritesState): FavoriteList {
  return (
    state.lists.find((list) => list.id === state.activeListId) ?? state.lists[0]!
  );
}

/** The list a tab shows; a missing or deleted id falls back to the active list. */
export function favoriteListById(
  state: FavoritesState,
  id: string | undefined,
): FavoriteList {
  return state.lists.find((list) => list.id === id) ?? activeFavoriteList(state);
}

export function toggleFavoriteInList(
  state: FavoritesState,
  id: string | undefined,
  key: string,
): FavoritesState {
  const list = favoriteListById(state, id);
  const items = list.items.includes(key)
    ? list.items.filter((item) => item !== key)
    : [...list.items, key];
  return {
    ...state,
    lists: state.lists.map((item) =>
      item.id === list.id ? { ...item, items } : item,
    ),
  };
}

export function toggleFavoriteInActiveList(
  state: FavoritesState,
  key: string,
): FavoritesState {
  return toggleFavoriteInList(state, state.activeListId, key);
}

export function selectFavoriteList(
  state: FavoritesState,
  id: string,
): FavoritesState {
  return state.lists.some((list) => list.id === id)
    ? { ...state, activeListId: id }
    : state;
}

export function addFavoriteList(
  state: FavoritesState,
  name: string,
): FavoritesState {
  const list: FavoriteList = {
    id: newListId(),
    name: uniqueName(state.lists, name),
    items: [],
  };
  return {
    ...state,
    lists: [...state.lists, list],
    activeListId: list.id,
  };
}

export function renameFavoriteList(
  state: FavoritesState,
  id: string,
  name: string,
): FavoritesState {
  if (!state.lists.some((list) => list.id === id)) return state;
  return {
    ...state,
    lists: state.lists.map((list) =>
      list.id === id ? { ...list, name: uniqueName(state.lists, name, id) } : list,
    ),
  };
}

/** Rename the default list once, after the display name changed from Favorites. */
export function migrateDefaultFavoriteName(state: FavoritesState): FavoritesState {
  const defaultList = state.lists.find(
    (list) => list.id === DEFAULT_FAVORITE_LIST_ID,
  );
  if (!defaultList || defaultList.name !== 'Favorites') return state;
  return renameFavoriteList(
    state,
    DEFAULT_FAVORITE_LIST_ID,
    DEFAULT_FAVORITE_LIST_NAME,
  );
}

function migrateStoredDefaultName(): void {
  try {
    if (localStorage.getItem(DEFAULT_NAME_MIGRATION_KEY)) return;
    localStorage.setItem(DEFAULT_NAME_MIGRATION_KEY, '1');
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!isFavoritesState(parsed)) return;
    const migrated = migrateDefaultFavoriteName(parsed);
    if (migrated !== parsed) {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(migrated));
    }
  } catch {
    /* storage unavailable — new installs still use the new default name */
  }
}

export function deleteFavoriteList(
  state: FavoritesState,
  id: string,
): FavoritesState {
  if (id === DEFAULT_FAVORITE_LIST_ID) return state;
  const lists = state.lists.filter((list) => list.id !== id);
  if (lists.length === 0) return state;
  const activeListId =
    state.activeListId === id || !lists.some((list) => list.id === state.activeListId)
      ? DEFAULT_FAVORITE_LIST_ID
      : state.activeListId;
  return { ...state, lists, activeListId };
}

export function clearFavoriteList(
  state: FavoritesState,
  id: string,
): FavoritesState {
  if (!state.lists.some((list) => list.id === id)) return state;
  return {
    ...state,
    lists: state.lists.map((list) =>
      list.id === id ? { ...list, items: [] } : list,
    ),
  };
}

/** Add every imported ticker to one list; list names in the file are ignored. */
export function mergeFavoritesIntoList(
  state: FavoritesState,
  id: string | undefined,
  imported: ParsedFavoriteList[],
): FavoritesState {
  const list = favoriteListById(state, id);
  const items = uniqueItems([
    ...list.items,
    ...imported.flatMap((item) => item.items),
  ]);
  return {
    ...state,
    lists: state.lists.map((item) =>
      item.id === list.id ? { ...item, items } : item,
    ),
  };
}

export function mergeFavoritesIntoActiveList(
  state: FavoritesState,
  imported: ParsedFavoriteList[],
): FavoritesState {
  return mergeFavoritesIntoList(state, state.activeListId, imported);
}

export function serializeFavorites(state: FavoritesState): string {
  return JSON.stringify(
    {
      version: 2,
      activeListId: state.activeListId,
      lists: state.lists.map((list) => ({
        id: list.id,
        name: list.name,
        items: list.items,
      })),
    },
    null,
    2,
  );
}

function normalizeItem(raw: string): string | null {
  let value = raw.trim();
  if (!value || value.startsWith('#')) return null;

  if (!value.includes(':')) {
    value = value.replace(/\.P$/i, '').toUpperCase();
    return TICKER.test(value) ? favoriteKey(value) : null;
  }

  const parts = value.split(':');
  if (parts.length === 3) {
    const venue = parts[0]!.trim().toLowerCase();
    const kind = parts[1]!.trim().toLowerCase();
    const native = parts[2]!.trim().replace(/\.P$/i, '').toUpperCase();
    if (
      !VENUE_SET.has(venue) ||
      (kind !== 'perp' && kind !== 'spot') ||
      !TICKER.test(native)
    ) {
      return null;
    }
    return `${venue}:${kind}:${native}`;
  }

  if (parts.length === 2) {
    const venue = parts[0]!.trim().toLowerCase();
    const native = parts[1]!.trim().replace(/\.P$/i, '').toUpperCase();
    if (!VENUE_SET.has(venue) || !TICKER.test(native)) return null;
    const kind: 'perp' | 'spot' = venue === 'coinbase' ? 'spot' : 'perp';
    return `${venue}:${kind}:${native}`;
  }

  return null;
}

function parseItems(values: unknown[]): { items: string[]; skipped: number } {
  const items: string[] = [];
  let skipped = 0;
  for (const value of values) {
    if (typeof value !== 'string') {
      skipped += 1;
      continue;
    }
    const item = normalizeItem(value);
    if (item) items.push(item);
    else skipped += 1;
  }
  return { items: uniqueItems(items), skipped };
}

/** Accept the v2 bundle, the old single-list JSON, a raw array, or plain lines. */
export function parseFavoritesFile(text: string): ParsedFavorites {
  const trimmed = text.trim();
  if (!trimmed) return { lists: [], skipped: 0 };

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    /* plain text below */
  }

  if (Array.isArray(parsed)) {
    const parsedItems = parseItems(parsed);
    return {
      lists: parsedItems.items.length
        ? [{ name: IMPORTED_LIST_NAME, items: parsedItems.items }]
        : [],
      skipped: parsedItems.skipped,
    };
  }

  if (parsed !== null && typeof parsed === 'object') {
    const bundle = parsed as {
      version?: number;
      lists?: Array<{ name?: unknown; items?: unknown }>;
      favorites?: unknown;
    };
    if (Array.isArray(bundle.lists)) {
      const lists: ParsedFavoriteList[] = [];
      let skipped = 0;
      for (const list of bundle.lists) {
        if (
          typeof list !== 'object' ||
          list === null ||
          !Array.isArray(list.items)
        ) {
          skipped += 1;
          continue;
        }
        const parsedItems = parseItems(list.items);
        skipped += parsedItems.skipped;
        if (parsedItems.items.length === 0) continue;
        lists.push({
          name:
            typeof list.name === 'string' && list.name.trim()
              ? list.name.trim()
              : IMPORTED_LIST_NAME,
          items: parsedItems.items,
        });
      }
      return { lists, skipped };
    }
    if (Array.isArray(bundle.favorites)) {
      const parsedItems = parseItems(bundle.favorites);
      return {
        lists: parsedItems.items.length
          ? [{ name: IMPORTED_LIST_NAME, items: parsedItems.items }]
          : [],
        skipped: parsedItems.skipped,
      };
    }
    return { lists: [], skipped: 1 };
  }

  const parsedItems = parseItems(trimmed.split(/[\n,;]+/));
  return {
    lists: parsedItems.items.length
      ? [{ name: IMPORTED_LIST_NAME, items: parsedItems.items }]
      : [],
    skipped: parsedItems.skipped,
  };
}
