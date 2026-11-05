import type { VelaTheme } from '@luxalgo/vela';

/**
 * Vela paints the chart surface itself, so these values mirror the app tokens in
 * `index.css`: `--background`, `--foreground` and `--border`. Keep the two files
 * in sync or the chart drifts from the rest of the UI.
 */
export const velaDarkTheme: VelaTheme = {
  background: '#030712',
  textColor: '#f3f4f6',
  gridColor: '#1f2937',
  borderColor: '#1f2937',
  upColor: '#089981',
  downColor: '#f23645',
  fontFamily: 'Geist Variable, Geist, system-ui, sans-serif',
};

export const velaLightTheme: VelaTheme = {
  background: '#f8fafc',
  textColor: '#0f172a',
  gridColor: '#e2e8f0',
  borderColor: '#e2e8f0',
  upColor: '#089981',
  downColor: '#f23645',
  fontFamily: 'Geist Variable, Geist, system-ui, sans-serif',
};
