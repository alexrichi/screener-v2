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

/** Skip spaces, newlines and `//` comments between two offsets. */
function skipTrivia(source: string, from: number, limit: number): number {
  let index = from;
  while (index < limit) {
    const char = source[index];
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index + 2);
      index = end < 0 || end > limit ? limit : end + 1;
      continue;
    }
    break;
  }
  return index;
}

/** The index of the closing quote, or -1 when the literal is unterminated. */
function closingQuote(source: string, start: number, limit: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < limit) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index;
    index += 1;
  }
  return -1;
}

/** Top-level argument spans of a call whose `(` is at `open`. */
function argumentSpans(
  source: string,
  open: number,
): Array<{ start: number; end: number }> | null {
  const spans: Array<{ start: number; end: number }> = [];
  let start = open + 1;
  let depth = 0;
  let index = open + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'") {
      const end = closingQuote(source, index, source.length);
      if (end < 0) return null;
      index = end + 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')' && depth === 0) {
      spans.push({ start, end: index });
      return spans;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      spans.push({ start, end: index });
      start = index + 1;
    }
    index += 1;
  }
  return null;
}

/** Offset of the first code line when it is an indicator/strategy declaration. */
function declarationOffset(source: string): number {
  let offset = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('//')) {
      offset += line.length + 1;
      continue;
    }
    return /^(?:indicator|strategy)\s*\(/.test(trimmed)
      ? offset + (line.length - trimmed.length)
      : -1;
  }
  return -1;
}

/**
 * Rename the title of the top-level `indicator(...)` / `strategy(...)`
 * declaration. Only a literal title is rewritten; any other expression and
 * scripts without a declaration stay untouched.
 */
export function renameScriptTitle(source: string, title: string): string {
  const next = title.trim();
  if (!next) return source;
  const declaration = declarationOffset(source);
  if (declaration < 0) return source;
  const open = source.indexOf('(', declaration);
  if (open < 0) return source;
  const spans = argumentSpans(source, open);
  if (!spans) return source;
  for (const [index, span] of spans.entries()) {
    const start = skipTrivia(source, span.start, span.end);
    if (start >= span.end) continue;
    const named = /^title\s*=/.exec(source.slice(start, span.end));
    let valueStart = start;
    if (named) {
      valueStart = skipTrivia(source, start + named[0].length, span.end);
    } else if (index !== 0) {
      continue;
    }
    const quote = source[valueStart];
    if (quote !== '"' && quote !== "'") continue;
    const valueEnd = closingQuote(source, valueStart, span.end);
    if (valueEnd < 0) continue;
    // Only rewrite a whole literal, not a concatenated expression.
    if (skipTrivia(source, valueEnd + 1, span.end) < span.end) continue;
    const escaped = next
      .replace(/\\/g, '\\\\')
      .split(quote)
      .join(`\\${quote}`);
    return `${source.slice(0, valueStart + 1)}${escaped}${source.slice(valueEnd)}`;
  }
  return source;
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
