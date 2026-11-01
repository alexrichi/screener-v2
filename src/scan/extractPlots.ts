import type { PlotValue } from '../types';

export interface PlotLike {
  title?: string;
  data?: Array<{ value?: unknown }>;
}

export function extractPlots(
  plots: Record<string, PlotLike> | undefined,
  limit = 12,
): PlotValue[] {
  if (!plots) return [];
  const result: PlotValue[] = [];
  for (const [key, plot] of Object.entries(plots)) {
    if (key.startsWith('__')) continue;
    const data = Array.isArray(plot.data) ? plot.data : [];
    let value: number | null = null;
    for (let index = data.length - 1; index >= 0; index -= 1) {
      const candidate = data[index]?.value;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        value = candidate;
        break;
      }
    }
    result.push({ key, title: String(plot.title ?? key), value });
    if (result.length >= limit) break;
  }
  return result;
}
