import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME, type ChartConfig } from '@luxalgo/vela';
import { chartDefaults, stripChartDefaults, stripChartDefaultsInState, stripWorkspaceDocument } from '../src/lib/velaChartConfig';
import { velaDarkTheme, velaLightTheme } from '../src/lib/velaTheme';

const THEMES = [velaLightTheme, velaDarkTheme, LIGHT_THEME, DARK_THEME];

describe('chartDefaults', () => {
  it('is a complete fresh document for the theme', () => {
    const cfg = chartDefaults(velaLightTheme);
    expect(cfg.layout.background).toBe('#ffffff');
    expect(cfg.grid.vertLines.visible).toBe(true);
    expect(cfg.priceScale.currentPriceLine).toBe(true);
    expect(cfg.series).toEqual({ style: 'candles', baseline: null, spacing: 1 });

    const bars = chartDefaults(velaDarkTheme, 'bars');
    expect(bars.layout.background).toBe('#0b1220');
    expect(bars.series.style).toBe('bars');
  });
});

describe('stripChartDefaults', () => {
  it('drops a fresh chart of any known theme entirely', () => {
    for (const theme of THEMES) expect(stripChartDefaults(chartDefaults(theme))).toEqual({});
  });

  it('drops a dark default saved in a light app, so it reopens in the current theme', () => {
    expect(stripChartDefaults(chartDefaults(velaDarkTheme, 'candles'))).toEqual({});
  });

  it('keeps a changed flag while dropping the theme colors around it', () => {
    const config: ChartConfig = chartDefaults(velaLightTheme);
    config.grid.vertLines.visible = false;
    config.margins = { top: 10, bottom: 10, right: 20 };
    expect(stripChartDefaults(config)).toEqual({
      grid: { vertLines: { visible: false } },
      margins: { right: 20 },
    });
  });

  it('keeps a color someone chose', () => {
    const config: ChartConfig = chartDefaults(velaDarkTheme);
    config.layout.background = '#123456';
    config.candles.upColor = '#abcdef';
    expect(stripChartDefaults(config)).toEqual({
      layout: { background: '#123456' },
      candles: { upColor: '#abcdef' },
    });
  });

  it('keeps a non-default price style and drops the default one', () => {
    expect(stripChartDefaults(chartDefaults(velaDarkTheme, 'bars')).series).toEqual({ style: 'bars' });
    expect(stripChartDefaults(chartDefaults(velaDarkTheme, 'candles')).series).toBeUndefined();
  });
});

describe('workspace state', () => {
  it('reduces every chart config and leaves the rest of the document alone', () => {
    const state = {
      version: 1,
      layout: { id: '2h' },
      charts: [
        { id: 'main', symbol: 'BTCUSDT.P', rendererConfig: chartDefaults(velaDarkTheme) },
        {
          id: 'alt',
          symbol: 'ETHUSDT.P',
          rendererConfig: { ...chartDefaults(velaLightTheme), margins: { top: 5, bottom: 10, right: 10 } },
        },
      ],
    };
    expect(stripChartDefaultsInState(state)).toEqual({
      version: 1,
      layout: { id: '2h' },
      charts: [
        { id: 'main', symbol: 'BTCUSDT.P', rendererConfig: {} },
        { id: 'alt', symbol: 'ETHUSDT.P', rendererConfig: { margins: { top: 5 } } },
      ],
    });
  });

  it('sanitizes a stored string and leaves malformed JSON untouched', () => {
    const raw = JSON.stringify({ charts: [{ rendererConfig: chartDefaults(velaDarkTheme) }] });
    expect(JSON.parse(stripWorkspaceDocument(raw))).toEqual({ charts: [{ rendererConfig: {} }] });
    expect(stripWorkspaceDocument('{nope')).toBe('{nope');
    expect(stripWorkspaceDocument('null')).toBe('null');
  });
});
