/**
 * Named workspace layouts: full chart snapshots built from
 * `VelaWorkspace.getState()`. The store lives in localStorage next to the tab
 * documents; import/export uses one JSON file.
 */

import type { PineInputValues } from '../types';

export const LAYOUTS_KEY = 'screener.layouts.v1';
export const LAYOUTS_VERSION = 1;
/** A second write of one large snapshot per save, so keep the list bounded. */
export const MAX_LAYOUTS = 40;
const MAX_NAME = 60;
const JSON_KIND = 'screener-layouts';

export interface LayoutPine {
  script: string;
  name: string;
  all: boolean;
  /** Input overrides of the applied script, restored with the layout. */
  inputs?: PineInputValues;
}

export interface LayoutItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Tab-level market identity for the button, tab badge and seeds. */
  symbol: string;
  timeframe: string;
  altSymbol: string;
  /** Vela layout id, also inside `state`. */
  layout: string;
  /** Vela workspace document; validated by `sanitizeState` when applied. */
  state: Record<string, unknown>;
  /** The applied editor script is app-owned, not part of the Vela document. */
  pine?: LayoutPine;
}

export interface LayoutLibrary {
  version: 1;
  items: LayoutItem[];
}

/** What the host captures from the live workspace. */
export interface LayoutCapture {
  symbol: string;
  timeframe: string;
  altSymbol: string;
  layout: string;
  state: unknown;
}

export interface LayoutApplyReport {
  ok: boolean;
  error: string | null;
  symbol: string;
  timeframe: string;
  layout: string;
  altSymbol: string;
  cells: number;
}

export interface ParsedLayouts {
  items: LayoutItem[];
  skipped: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback;

const asTime = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function newLayoutId(): string {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Accepts only the document shape `applyState` can use; deeper fields are its job. */
function isLayoutState(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === 1 && typeof value.layout === 'string';
}

function isLayoutPine(value: unknown): value is LayoutPine {
  return (
    isRecord(value) &&
    typeof value.script === 'string' &&
    typeof value.name === 'string' &&
    typeof value.all === 'boolean' &&
    (value.inputs === undefined || isInputValues(value.inputs))
  );
}

function isInputValues(value: unknown): value is PineInputValues {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (item) =>
      typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
  );
}

export function isLayoutItem(value: unknown): value is LayoutItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.symbol === 'string' &&
    typeof value.timeframe === 'string' &&
    typeof value.altSymbol === 'string' &&
    typeof value.layout === 'string' &&
    value.layout.length > 0 &&
    isLayoutState(value.state) &&
    (value.pine === undefined || isLayoutPine(value.pine))
  );
}

export function isLayoutLibrary(value: unknown): value is LayoutLibrary {
  if (!isRecord(value)) return false;
  return (
    value.version === LAYOUTS_VERSION &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_LAYOUTS &&
    value.items.every(isLayoutItem)
  );
}

/** Read the store, dropping a malformed document rather than crashing the app. */
export function readLayouts(storage: Storage = localStorage): LayoutLibrary {
  try {
    const raw = storage.getItem(LAYOUTS_KEY);
    if (!raw) return { version: LAYOUTS_VERSION, items: [] };
    const parsed: unknown = JSON.parse(raw);
    return isLayoutLibrary(parsed) ? parsed : { version: LAYOUTS_VERSION, items: [] };
  } catch {
    return { version: LAYOUTS_VERSION, items: [] };
  }
}

/**
 * Write synchronously so a full localStorage is reported to the user instead of
 * being swallowed by the generic persisted-state hook.
 */
export function persistLayouts(
  library: LayoutLibrary,
  storage: Storage = localStorage,
): string | null {
  try {
    storage.setItem(LAYOUTS_KEY, JSON.stringify(library));
    return null;
  } catch (cause) {
    const quota =
      cause instanceof DOMException &&
      (cause.name === 'QuotaExceededError' || cause.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return quota
      ? 'Layout storage is full. Export the layouts you need, then delete older ones.'
      : 'Layouts could not be saved in this browser.';
  }
}

/** A case-insensitive unique display name; keeps the user's spelling otherwise. */
export function uniqueLayoutName(
  items: readonly LayoutItem[],
  name: string,
  exceptId?: string,
): string {
  const base = name.trim().slice(0, MAX_NAME) || 'Layout';
  const taken = new Set(
    items
      .filter((item) => item.id !== exceptId)
      .map((item) => item.name.trim().toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, MAX_NAME - 8)} ${Date.now().toString(36)}`;
}

export function createLayout(
  name: string,
  capture: LayoutCapture,
  pine?: LayoutPine,
): LayoutItem {
  const now = Date.now();
  const item: LayoutItem = {
    id: newLayoutId(),
    name: name.trim().slice(0, MAX_NAME) || 'Layout',
    createdAt: now,
    updatedAt: now,
    symbol: capture.symbol,
    timeframe: capture.timeframe,
    altSymbol: capture.altSymbol,
    layout: capture.layout,
    state: capture.state as Record<string, unknown>,
  };
  if (pine) item.pine = pine;
  return item;
}

export function updateLayout(
  item: LayoutItem,
  capture: LayoutCapture,
  pine?: LayoutPine,
): LayoutItem {
  const next: LayoutItem = {
    ...item,
    updatedAt: Date.now(),
    symbol: capture.symbol,
    timeframe: capture.timeframe,
    altSymbol: capture.altSymbol,
    layout: capture.layout,
    state: capture.state as Record<string, unknown>,
  };
  if (pine) next.pine = pine;
  else delete next.pine;
  return next;
}

export function duplicateLayout(item: LayoutItem, name: string): LayoutItem {
  const now = Date.now();
  return {
    ...item,
    id: newLayoutId(),
    name: name.trim().slice(0, MAX_NAME) || `${item.name} copy`,
    createdAt: now,
    updatedAt: now,
    state: structuredClone(item.state),
    ...(item.pine ? { pine: { ...item.pine } } : {}),
  };
}

/** File shape: every layout, or one; the loader accepts both plus a bare array. */
export function layoutsJson(items: readonly LayoutItem[]): string {
  return JSON.stringify(
    {
      version: LAYOUTS_VERSION,
      kind: JSON_KIND,
      exportedAt: new Date().toISOString(),
      items,
    },
    null,
    2,
  );
}

function normalizeLayout(value: unknown, now: number): LayoutItem | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (!isLayoutState(state)) return null;
  const layout = asString(value.layout) || asString(state.layout);
  const timeframe = asString(value.timeframe);
  const symbol = asString(value.symbol);
  if (!layout || !timeframe || !symbol) return null;
  const name = asString(value.name).slice(0, MAX_NAME);
  if (!name) return null;
  const pine = isLayoutPine(value.pine) ? value.pine : undefined;
  return {
    id: newLayoutId(),
    name,
    createdAt: asTime(value.createdAt, now),
    updatedAt: asTime(value.updatedAt, now),
    symbol,
    timeframe,
    altSymbol: asString(value.altSymbol),
    layout,
    state,
    ...(pine ? { pine } : {}),
  };
}

/**
 * Import gate: malformed entries are skipped, ids are regenerated, and names
 * are made unique by the caller against the live library.
 */
export function parseLayoutsFile(text: string): ParsedLayouts {
  const trimmed = text.trim();
  if (!trimmed) return { items: [], skipped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { items: [], skipped: 0 };
  }
  const values = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : isRecord(parsed) && isLayoutState(parsed.state)
        ? [parsed]
        : [];
  const now = Date.now();
  const items: LayoutItem[] = [];
  let skipped = 0;
  for (const value of values) {
    const item = normalizeLayout(value, now);
    if (item) items.push(item);
    else skipped += 1;
  }
  return { items, skipped };
}
