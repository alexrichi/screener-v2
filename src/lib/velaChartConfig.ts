import {
  DARK_THEME,
  LIGHT_THEME,
  defaultChartConfig,
  type ChartConfig,
  type PriceStyle,
  type VelaTheme,
} from '@luxalgo/vela';
import { velaDarkTheme, velaLightTheme } from './velaTheme';

/**
 * Saved workspaces, layouts and chart templates keep only the chart settings that
 * differ from a fresh chart's defaults. Vela's `getConfig()` resolves every value,
 * theme colors included, so writing it verbatim pins the theme the chart was saved
 * under. The defaults themselves come from Vela core for the current theme; older
 * documents saved under the other app theme (or a bundled Vela theme) are
 * recognized too, so they migrate on the next read.
 */
const KNOWN_THEMES: readonly VelaTheme[] = [velaLightTheme, velaDarkTheme, LIGHT_THEME, DARK_THEME];

/** A fresh chart config for `theme`, with `priceStyle` as the chosen chart type. */
export function chartDefaults(theme: VelaTheme, priceStyle: PriceStyle = 'candles'): ChartConfig {
  return defaultChartConfig(theme, { priceStyle });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The value when it differs from every base, `undefined` when it matches one. */
function diffValue(value: unknown, bases: readonly unknown[]): unknown {
  if (isObject(value) && bases.every(isObject)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const diff = diffValue(
        child,
        bases.map((base) => base[key]),
      );
      if (diff !== undefined) out[key] = diff;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return bases.some((base) => sameValue(value, base)) ? undefined : value;
}

/** `config` reduced to the settings that are not a known theme's default. */
export function stripChartDefaults(config: unknown): Record<string, unknown> {
  if (!isObject(config)) return {};
  const diff = diffValue(
    config,
    KNOWN_THEMES.map((theme) => defaultChartConfig(theme)),
  );
  return isObject(diff) ? diff : {};
}

/** The same reduction for a workspace state document (`{ charts: [{ rendererConfig }] }`). */
export function stripChartDefaultsInState<T>(state: T): T {
  if (!isObject(state) || !Array.isArray(state.charts)) return state;
  const charts = state.charts.map((chart) => {
    if (!isObject(chart) || chart.rendererConfig == null) return chart;
    return { ...chart, rendererConfig: stripChartDefaults(chart.rendererConfig) };
  });
  return { ...state, charts } as T;
}

/** The storage form of a workspace document, with every chart config reduced. */
export function stripWorkspaceDocument(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return raw;
    return JSON.stringify(stripChartDefaultsInState(parsed));
  } catch {
    return raw;
  }
}
