# Changelog

The app follows the semver in `package.json`. About shows that version next to
the build stamp; the updater compares only the version.

## Unreleased

- Binance spot is listed beside its USDⓈ-M perpetuals. Spot rows, charts, the
  scanner, and order flow use the spot REST/WS endpoints; `BINANCE:BTCUSDT` is
  spot and `BINANCE:BTCUSDT.P` the perpetual, while a bare ticker still means the
  perpetual.
- The Order flow side panel aggregates public books and tapes from all six
  venues, with Binance spot and its perpetual as two separate books: a
  `BTCUSDT.P` chart reads seven books. `Book` shows the ladder around the chart
  venue's mid, `DOM` shows sold, bought and delta at each price since opening or
  Reset, and `Trades` filters by notional, joins one order's fills, pauses, and
  freezes on hover. The `Book` histogram follows the `Size` / `Total` choice, so
  `Running total` draws the cumulative ladder. Binance trades are marked `S` or
  `P`, and tiny sizes print as decimals instead of scientific notation. Prices group at a chosen step;
  each instrument keeps its own step and Book/DOM/Trades settings, while the
  visible tab and venue list stay panel-wide. The panel follows the active chart
  symbol.
- Pine indicators can arm an alert from their legend bell. The alert keeps a
  snapshot of the script, inputs, symbol and timeframe and runs on closed bars in
  the sidecar after the chart or workspace tab closes. The Alerts panel separates
  the armed rules from a persistent history, with toast, sound and system
  notifications, global unread badges, pause and delete. Only alerts you create
  reach the history: a chart's live alert events no longer add rows on their own.
  `request.*` scripts run through a sidecar session host over the venue hubs; a
  missing series adds a warning instead of stopping the rule, while a venue the
  app does not serve yields `na` without a warning, like the chart. The renderer
  ignores warning, error and live-event frames for a rule it no longer has, and
  its next config clears that stale rule from disk. Viewport-dependent scripts
  are rejected when the alert is created. Screener-wide alerts are not available.
- The alert runner now belongs to the sidecar process, not to the renderer
  socket: armed rules keep evaluating through app reloads and sidecar restarts,
  and events that fire while the app is away arrive as one summary toast on
  reconnect. Rules stay renderer-owned (`alerts.json` beside `ai.json` is the
  restart cache), cleared history stays cleared across reconnects, an only-once
  rule is retired on disk and cannot be resurrected by a stale reconnect, a
  paused rule re-enabled never fires the bar that closed while it was off, and a
  bar closed during a reconnect is no longer lost. `Screener.exe --smoke` runs
  against a throwaway alerts file and fails fast (with a written result instead
  of a modal dialog) when a sidecar already listens on 8787.

## 0.1.7 — 2026-11-21

- Updated Vela to 0.10.14.
- A Pine indicator keeps its fills, `bgcolor` spans, `hline`s and `barcolor`s when
  it runs again over older history. Previously those stayed on the first run's
  candles while the lines moved.
- The status bar countdown and clock correct for a slow device clock, so the
  countdown no longer jumps up a minute at the bar close.
- Maximizing one chart on a phone no longer keeps the hidden charts at full
  canvas size, which could exhaust Safari's memory on a 2×2 layout.

## 0.1.6 — 2026-11-19
Commit: 8e03e56

- Coin icons no longer come from a ticker-keyed logo CDN. Its logo id is not the
  ticker, so HYPE, ARB, SPX and PENGU showed another asset's mark. The sidecar
  now tries Ledger (the set Vela's bundled providers use), OKX, Binance, CoinCap
  and FMP, and the icon URL carries a version so browsers drop the cached image.
- Unchecking a venue now stops all of its work: a ticker poll already in flight
  cannot bring its rows back, its warm/refresh queues are dropped, and OKX's
  funding WebSocket closes (it reconnects when the venue is checked again).
- Workspaces, named layouts and chart settings templates now save only the chart
  settings that differ from Vela's default for the current theme. Theme colors
  and default values no longer enter the saved document, so a saved chart opens
  in the theme you are using, and changing one checkbox stores one checkbox.
  `Apply defaults` resets to the current theme's defaults, and the chart settings
  dialog follows the app theme.

## 0.1.5 — 2026-11-18
Commit: fd61db9

- Replay bar matches the reference: `Start bar` re-arms the chart picker,
  `Select date` is the alternate start, speed is a multiplier, the panel is
  draggable, and the X stops and exits.
- Picking dims every cell and can start from the clicked cell. History extension
  and the renderer's scroll-to-latest button are disabled while replaying.
- `Select date` opens a calendar immediately and works with no loaded bars. A
  date older than the loaded history deepens every cell with the reference
  cell's symbol before the replay starts.

## 0.1.4 — 2026-11-18
Commit: eb0d43e

- Bar replay: the `Replay` button after `Indicators` opens a control bar. Pick a
  bar or type a date, then play/pause, step, change speed, or stop. Every cell
  rewinds on one clock; Vela pauses live updates and mutes alerts. Session-only.

## 0.1.3 — 2026-11-18
Commit: 3170f99

- A title bar button appears when an update has downloaded. The app no longer
  opens a modal on its own; clicking the button asks before restarting.
- Update state is exposed to the renderer through the preload bridge, and the
  button reads the current state when the window opens.

## 0.1.2 — 2026-11-18
Commit: 6267dcb

- About shows the package version (`Version 0.1.2`) next to the build stamp
  (`Build 0.2026...`).
- Verified a differential update from 0.1.1.

## 0.1.1 — 2026-11-18
Commit: bf550c9

- Patch release used to verify the GitHub release update path.

## 0.1.0 — 2026-11-18
Commit: 308c490

- First public NSIS installer for Windows.
- GitHub release updater with `latest.yml` and background downloads.
- HashHedge partner button in the title bar.
- MIT license and the workspace screenshot in the README.

[0.1.4]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.4
[0.1.3]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.3
[0.1.2]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.2
[0.1.1]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.1
[0.1.0]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.0
