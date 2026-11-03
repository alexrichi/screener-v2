import catalog from '../data/luxalgoCatalog.json';
import { sidecarBaseUrl } from '../venues/sidecar';

export interface LibraryItem {
  slug: string;
  name: string;
  family: string;
  date: string;
  codeId: string;
  imageUrl: string;
  description: string;
}

const FAMILY_LABELS: Record<string, string> = {
  trend: 'Trend',
  momentum: 'Momentum',
  volatility: 'Volatility',
  'volume-orderflow': 'Volume & Flow',
  'market-structure': 'Structure',
  'smc-ict': 'SMC / ICT',
  wyckoff: 'Wyckoff',
  'elliott-harmonics': 'Elliott & Harmonics',
  patterns: 'Patterns',
  levels: 'Levels',
  statistics: 'Statistics',
  'machine-learning': 'Machine Learning',
  'time-seasonality': 'Time & Sessions',
  'sentiment-breadth': 'Sentiment & Breadth',
  'risk-exits': 'Risk & Exits',
  'meta-composition': 'Meta',
  validation: 'Validation',
};

export const LIBRARY_ITEMS: LibraryItem[] = catalog.items;

export function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? family;
}

export function libraryPageUrl(slug: string): string {
  return `https://www.luxalgo.com/library/indicator/${encodeURIComponent(slug)}/`;
}

/** Same resizing proxy the Vela picker uses; ~5 KB per card instead of ~60 KB. */
export function libraryImageUrl(imageUrl: string, width = 384): string {
  if (!imageUrl) return '';
  return `https://vela.luxalgo.com/_next/image?url=${encodeURIComponent(imageUrl)}&w=${width}&q=75`;
}

/** Newest first, as bundled. An empty query keeps that order. */
export function filterLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.family.toLowerCase().includes(needle) ||
      item.slug.includes(needle) ||
      item.description.toLowerCase().includes(needle),
  );
}

export async function fetchLibrarySource(
  codeId: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `${sidecarBaseUrl()}/library/source?codeId=${encodeURIComponent(codeId)}`,
    { signal },
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(detail ? `Sidecar ${response.status}: ${detail}` : `Sidecar ${response.status}`);
  }
  const payload = (await response.json()) as { code?: unknown };
  if (typeof payload.code !== 'string' || !payload.code.trim()) {
    throw new Error('The Library returned an empty script');
  }
  return payload.code;
}
