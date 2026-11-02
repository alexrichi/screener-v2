# Screener v2

A Binance USDT-M perpetual futures screener with Vela charts and a Pine Script
scanner. The UI is a Vite + React + TypeScript app; there is no private backend
and no API key.

## Stack

- Vite 8, React 19, TypeScript, Tailwind CSS v4
- Base UI, Lucide, Sonner, Geist Sans / Geist Mono
- `@luxalgo/vela` workspace and bundled Binance provider
- `@luxalgo/vela-pinets` + `pinets` for Pine Script indicators and the scanner
- CodeMirror 6 (`@uiw/react-codemirror`) with a Pine language mode from the
  local Vela-pinets `editor` entry
- Binance public futures REST API

The app resolves `@luxalgo/vela` and `@luxalgo/vela-pinets/editor` to the local
`../Vela` and `../Vela-pinets` checkouts, so chart and editor changes run live.

## Run

```bash
npm install
npm run dev
```

```bash
npm run typecheck
npm test
npm run build
```

The public-data sidecar skeleton runs separately:

```bash
npm run sidecar
# http://127.0.0.1:8787/health
```

## What it does

- Binance USDT-M and OKX USDT perpetuals. The instrument picker lists both
  venues, sorted by ticker across exchanges; a chart opens the venue of the
  selected ticker. The screener table and the scanner still run on Binance only.
- Multi-chart Vela workspaces: `1`, `2×1`, `1×2`, `2×2`, `4×2`; cells keep their
  own symbol and timeframe. Dragging a chart into the past keeps loading older
  history. The header button left of `Alerts` maximizes the
  selected chart over the widget and restores the grid on a second click.
- Screener table with search, gainers/losers filters, sorting, resizable and
  reorderable columns, and per-row actions. Screener, Pine, and Library open as
  Vela side panels from the chart header; the open panel and width persist.
- Favorites: star a symbol and open the `Favorites` tab. Saved to localStorage
  and kept visible even when a symbol falls outside `topN` or the volume filter.
- Pine editor with presets and CodeMirror highlighting, completions, folding,
  search, and lint. Apply a script to the active chart or all charts in the
  workspace.
- Saved indicator library stored in localStorage. Save, rename, duplicate, and
  delete scripts; export or import `.pine` files and the JSON library. Saved
  scripts also appear in Vela's `Indicators → My scripts` section, above the
  built-in catalogue.
- Source button on every Pine indicator legend row: opens the exact script Vela
  is running in the editor, and selects the matching saved indicator.
- Scanner runs the same script over closed candles in a Web Worker and adds the
  last plot values as table columns.

## Notes

- Vela is Apache-2.0; its in-chart attribution mark stays enabled.
- Vela PineTS and PineTS are AGPL-3.0. This app is intended for private use;
  distributing or hosting it triggers AGPL obligations or requires a commercial
  license.
- The app reads public market data only. It does not trade.
- The sidecar exposes public Binance and OKX data through one `VenueAdapter`
  per venue and a shared cache. The table, scanner, and Vela charts use the
  sidecar only; there is no direct exchange path in the browser. Charts stream
  live candles over `ws://127.0.0.1:8787/stream`; the sidecar keeps one stream
  per symbol/timeframe and fans it out to every chart. If the venue socket stays
  silent (or the venue has no WS feed yet), the sidecar falls back to one REST
  poll per second for that stream. The instrument picker lists both venues and
  opens the selected exchange's chart.
