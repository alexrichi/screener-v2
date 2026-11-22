import { createTheme, type VelaTheme } from '@luxalgo/vela';

const darkUi = createTheme({ base: 'dark' }).settings;
const lightUi = createTheme({ base: 'light' }).settings;

/** The canvas font Vela draws axes, ticks and labels with. */
export const VELA_FONT_FAMILY = 'Geist Variable, Geist, system-ui, sans-serif';

export const velaDarkTheme: VelaTheme = {
  background: '#0b1220',
  textColor: '#d1d5db',
  gridColor: '#1f2937',
  borderColor: '#374151',
  upColor: '#089981',
  downColor: '#f23645',
  fontFamily: VELA_FONT_FAMILY,
  ui: darkUi,
};

export const velaLightTheme: VelaTheme = {
  background: '#ffffff',
  textColor: '#334155',
  gridColor: '#e2e8f0',
  borderColor: '#cbd5e1',
  upColor: '#089981',
  downColor: '#f23645',
  fontFamily: VELA_FONT_FAMILY,
  ui: lightUi,
};
