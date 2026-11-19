# Changelog

The app follows the semver in `package.json`. About shows that version next to
the build stamp; the updater compares only the version.

## Unreleased

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
