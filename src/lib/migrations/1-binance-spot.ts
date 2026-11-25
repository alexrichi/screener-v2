import { VENUE_IDS } from '../../venues/catalog';
import type { Migration, MigrationStorage } from './types';

const SETTINGS_KEY = 'screener.settings';
const FAVORITES_KEY = 'screener.favorites.v2';
const ORDER_FLOW_KEY = 'screener.orderflow.v2';
const ALERT_RULES_KEY = 'screener.alerts.rules.v1';
const ALERT_LOG_KEY = 'screener.alerts.log.v1';
const TABS_KEY = 'screener.tabs';
const LAYOUTS_KEY = 'screener.layouts.v1';
const MARKET_VENUES_KEY = 'screener.marketVenues';
const WORKSPACE_PREFIX = 'screener-v2:ws:';

const SPOT_VENUE = 'binance_spot';
const SPOT_PREFIX = 'BINANCE.SPOT';
/** Venue ids used by intermediate builds before the final `binance_spot` id. */
const LEGACY_SPOT_VENUES = new Set(['binance-spot', 'binance.spot']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readJson(storage: MigrationStorage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    // Malformed data stays as it is; the app's validators fall back to defaults.
    return undefined;
  }
}

function writeJson(storage: MigrationStorage, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

function rewriteJson(
  storage: MigrationStorage,
  key: string,
  migrate: (value: unknown) => unknown,
): void {
  const value = readJson(storage, key);
  if (value === undefined) return;
  const next = migrate(value);
  // Every transform returns the same object when it changed nothing.
  if (next !== value) writeJson(storage, key, next);
}

function storageKeys(storage: MigrationStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

function currentVenueId(venue: string): string {
  return LEGACY_SPOT_VENUES.has(venue) ? SPOT_VENUE : venue;
}

/** `BINANCE:BTCUSDT`, `BINANCE-SPOT:` and the interim `BINANCE_SPOT:` form. */
function legacySpotSymbol(symbol: unknown): string | undefined {
  if (typeof symbol !== 'string') return undefined;
  const at = symbol.indexOf(':');
  if (at < 0) return undefined;
  const provider = symbol.slice(0, at).toUpperCase();
  const ticker = symbol.slice(at + 1);
  if (provider === 'BINANCE-SPOT' || provider === 'BINANCE_SPOT') {
    return `${SPOT_PREFIX}:${ticker}`;
  }
  if (provider === 'BINANCE' && !/\.P$/i.test(ticker)) return `${SPOT_PREFIX}:${ticker}`;
  return undefined;
}

function migrateSettings(value: unknown): unknown {
  if (!isObject(value) || !isNumber(value.minVolume)) {
    // Still re-key a spot threshold saved under an intermediate venue id.
    if (!isObject(value) || !isObject(value.minVolumeByVenue)) return value;
    const source = value.minVolumeByVenue;
    const keys = Object.keys(source);
    if (!keys.some((key) => LEGACY_SPOT_VENUES.has(key))) return value;
    const overrides: Record<string, number> = {};
    for (const [venue, amount] of Object.entries(source)) {
      if (!isNumber(amount)) continue;
      const id = currentVenueId(venue);
      if (overrides[id] === undefined) overrides[id] = amount;
    }
    return { ...value, minVolumeByVenue: overrides };
  }

  const source = isObject(value.minVolumeByVenue) ? value.minVolumeByVenue : {};
  const overrides: Record<string, number> = {};
  if (isNumber(source[SPOT_VENUE])) overrides[SPOT_VENUE] = source[SPOT_VENUE];
  for (const [venue, amount] of Object.entries(source)) {
    if (!isNumber(amount)) continue;
    const id = currentVenueId(venue);
    if (overrides[id] === undefined) overrides[id] = amount;
  }
  for (const venue of VENUE_IDS) {
    if (overrides[venue] === undefined) overrides[venue] = value.minVolume;
  }
  const { minVolume: _legacy, ...rest } = value;
  return { ...rest, minVolumeByVenue: overrides };
}

function migrateFavoriteKeys(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.lists)) return value;
  let changed = false;
  const lists = value.lists.map((list) => {
    if (!isObject(list) || !Array.isArray(list.items)) return list;
    const items = list.items.map((item) => {
      if (typeof item !== 'string') return item;
      for (const prefix of ['binance:spot:', 'binance-spot:spot:', 'binance.spot:spot:', 'binance_spot:spot:']) {
        if (item.startsWith(prefix)) {
          changed = true;
          return `${SPOT_VENUE}:spot:${item.slice(prefix.length)}`;
        }
      }
      return item;
    });
    return { ...list, items };
  });
  return changed ? { ...value, lists } : value;
}

/** The current per-symbol order-flow settings key. */
function orderFlowSymbolKey(symbol: string): string {
  const at = symbol.indexOf(':');
  const ticker = (at >= 0 ? symbol.slice(at + 1) : symbol).toUpperCase();
  if (at < 0) return `BINANCE:${ticker.endsWith('.P') ? ticker : `${ticker}.P`}`;
  const migrated = legacySpotSymbol(symbol);
  if (migrated) return migrated.toUpperCase();
  return `${symbol.slice(0, at).toUpperCase()}:${ticker}`;
}

function migratePeerId(id: unknown): unknown {
  if (typeof id !== 'string') return id;
  if (id === 'binance:spot' || id === 'binance-spot:spot' || id === 'binance.spot:spot' || id === 'binance_spot:spot') {
    return `${SPOT_VENUE}:spot`;
  }
  for (const prefix of ['binance:spot:', 'binance-spot:spot:', 'binance.spot:spot:', 'binance_spot:spot:']) {
    if (id.startsWith(prefix)) return `${SPOT_VENUE}:spot:${id.slice(prefix.length)}`;
  }
  return id;
}

/** Old `binance` meant both Binance markets; now spot is its own venue. */
function migratePeerList(list: unknown): { list: unknown; changed: boolean } {
  if (!Array.isArray(list)) return { list, changed: false };
  let changed = false;
  const next: unknown[] = [];
  let hasBinance = false;
  for (const id of list) {
    const migrated = migratePeerId(id);
    if (migrated !== id) changed = true;
    if (migrated === 'binance') hasBinance = true;
    if (!next.includes(migrated)) next.push(migrated);
  }
  if (hasBinance && !next.includes(`${SPOT_VENUE}:spot`)) {
    next.push(`${SPOT_VENUE}:spot`);
    changed = true;
  }
  return { list: next, changed };
}

function migrateOrderFlowPreferences(value: unknown): unknown {
  if (!isObject(value)) return value;
  let changed = false;

  const topVenues = migratePeerList(value.venues);
  if (topVenues.changed) changed = true;

  let symbols: Record<string, unknown> | undefined;
  if (isObject(value.symbols)) {
    symbols = {};
    for (const [key, entry] of Object.entries(value.symbols)) {
      const nextKey = orderFlowSymbolKey(key);
      if (nextKey !== key) changed = true;
      if (isObject(entry)) {
        const venues = migratePeerList(entry.venues);
        if (venues.changed) {
          changed = true;
          symbols[nextKey] = { ...entry, venues: venues.list };
          continue;
        }
      }
      symbols[nextKey] = entry;
    }
  }

  if (!changed) return value;
  return {
    ...value,
    ...(topVenues.changed ? { venues: topVenues.list } : {}),
    ...(symbols ? { symbols } : {}),
  };
}

function migrateAlertRuleTargets(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const rules = value.map((raw) => {
    if (!isObject(raw) || !isObject(raw.target)) return raw;
    const target = raw.target;
    const velaSymbol = legacySpotSymbol(target.velaSymbol);
    if (!velaSymbol) return raw;
    changed = true;
    return { ...raw, target: { ...target, venue: SPOT_VENUE, velaSymbol } };
  });
  return changed ? rules : value;
}

function migrateAlertLog(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.events)) return value;
  let changed = false;
  const events = value.events.map((raw) => {
    if (!isObject(raw)) return raw;
    const velaSymbol = legacySpotSymbol(raw.velaSymbol);
    if (!velaSymbol) return raw;
    changed = true;
    return { ...raw, velaSymbol, venue: SPOT_VENUE };
  });
  return changed ? { ...value, events } : value;
}

function migrateMarketVenues(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const next: unknown[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      next.push(item);
      continue;
    }
    const id = currentVenueId(item);
    if (id !== item) changed = true;
    if (!next.includes(id)) next.push(id);
  }
  return changed ? next : value;
}

function migrateTabs(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const tabs = value.map((raw) => {
    if (!isObject(raw)) return raw;
    const symbol = legacySpotSymbol(raw.symbol);
    const altSymbol = legacySpotSymbol(raw.altSymbol);
    if (!symbol && !altSymbol) return raw;
    changed = true;
    return {
      ...raw,
      ...(symbol ? { symbol } : {}),
      ...(altSymbol ? { altSymbol } : {}),
    };
  });
  return changed ? tabs : value;
}

function migrateWorkspaceSymbols(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.charts)) return value;
  let changed = false;
  const charts = value.charts.map((raw) => {
    if (!isObject(raw)) return raw;
    const symbol = legacySpotSymbol(raw.symbol);
    let chart = raw;
    if (symbol) {
      changed = true;
      chart = {
        ...chart,
        symbol,
        ...(typeof chart.provider === 'string' ? { provider: SPOT_PREFIX } : {}),
      };
    }
    const ext = chart.ext;
    if (!isObject(ext)) return chart;
    const scale = ext['screener.scale'];
    if (!isObject(scale)) return chart;
    const scaleSymbol = legacySpotSymbol(scale.symbol);
    if (!scaleSymbol) return chart;
    changed = true;
    return {
      ...chart,
      ext: { ...ext, 'screener.scale': { ...scale, symbol: scaleSymbol } },
    };
  });
  return changed ? { ...value, charts } : value;
}

function migrateLayouts(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.items)) return value;
  let changed = false;
  const items = value.items.map((raw) => {
    if (!isObject(raw)) return raw;
    const state = migrateWorkspaceSymbols(raw.state);
    const symbol = legacySpotSymbol(raw.symbol);
    const altSymbol = legacySpotSymbol(raw.altSymbol);
    if (state === raw.state && !symbol && !altSymbol) return raw;
    changed = true;
    return {
      ...raw,
      state,
      ...(symbol ? { symbol } : {}),
      ...(altSymbol ? { altSymbol } : {}),
    };
  });
  return changed ? { ...value, items } : value;
}

/** Binance spot moved to its own venue and watch thresholds became per venue. */
export const migration: Migration = {
  schema: 1,
  run(storage) {
    rewriteJson(storage, SETTINGS_KEY, migrateSettings);
    rewriteJson(storage, MARKET_VENUES_KEY, migrateMarketVenues);
    rewriteJson(storage, FAVORITES_KEY, migrateFavoriteKeys);
    rewriteJson(storage, ORDER_FLOW_KEY, migrateOrderFlowPreferences);
    rewriteJson(storage, ALERT_RULES_KEY, migrateAlertRuleTargets);
    rewriteJson(storage, ALERT_LOG_KEY, migrateAlertLog);
    rewriteJson(storage, TABS_KEY, migrateTabs);
    rewriteJson(storage, LAYOUTS_KEY, migrateLayouts);
    for (const key of storageKeys(storage)) {
      if (key.startsWith(WORKSPACE_PREFIX)) rewriteJson(storage, key, migrateWorkspaceSymbols);
    }
  },
};
