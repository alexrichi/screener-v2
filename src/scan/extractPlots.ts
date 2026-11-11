import type { PinePlot } from '@screener/pine-engine';
import type { PlotValue } from '../types';

/** Last finite value per engine plot, in declaration order. */
export function extractEnginePlots(plots: readonly PinePlot[], limit = 12): PlotValue[] {
  const result: PlotValue[] = [];
  for (const plot of plots) {
    if (plot.id.startsWith('__')) continue;
    let value: number | null = null;
    for (let index = plot.values.length - 1; index >= 0; index -= 1) {
      const candidate = plot.values[index];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        value = candidate;
        break;
      }
    }
    result.push({ key: plot.id, title: plot.title, value });
    if (result.length >= limit) break;
  }
  return result;
}
