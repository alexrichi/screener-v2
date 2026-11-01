export interface SavedIndicator {
  id: string;
  name: string;
  /** Exact Pine source. Never transpiled. */
  source: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface IndicatorLibrary {
  version: 1;
  items: SavedIndicator[];
}

export const INDICATOR_LIBRARY_KEY = 'screener.indicators.v1';

export const EMPTY_LIBRARY: IndicatorLibrary = { version: 1, items: [] };

export function newIndicatorId(): string {
  return `i${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isSavedIndicator(value: unknown): value is SavedIndicator {
  const item = value as Partial<SavedIndicator>;
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    typeof item.source === 'string' &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number' &&
    typeof item.version === 'number' &&
    (item.notes === undefined || typeof item.notes === 'string')
  );
}

export function isIndicatorLibrary(value: unknown): value is IndicatorLibrary {
  const library = value as Partial<IndicatorLibrary>;
  return (
    typeof library === 'object' &&
    library !== null &&
    library.version === 1 &&
    Array.isArray(library.items) &&
    library.items.every(isSavedIndicator)
  );
}

export function createIndicator(name: string, source: string, notes?: string): SavedIndicator {
  const now = Date.now();
  return {
    id: newIndicatorId(),
    name: name.trim(),
    source,
    notes: notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function hasName(
  items: SavedIndicator[],
  name: string,
  exceptId?: string,
): boolean {
  const needle = name.trim().toLowerCase();
  return items.some(
    (item) => item.id !== exceptId && item.name.trim().toLowerCase() === needle,
  );
}

export function parseLibraryJson(text: string): IndicatorLibrary {
  const parsed: unknown = JSON.parse(text);
  if (isIndicatorLibrary(parsed)) return parsed;
  if (Array.isArray(parsed) && parsed.every(isSavedIndicator)) {
    return { version: 1, items: parsed };
  }
  throw new Error('Not a Screener indicator library');
}

export function libraryJson(library: IndicatorLibrary): string {
  return JSON.stringify(library, null, 2);
}

export function pineFileName(name: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `${safe || 'indicator'}.pine`;
}
