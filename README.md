# Screener v2

A multi-venue crypto screener (Binance, OKX, Bybit, Bitget, Hyperliquid,
Coinbase) with Vela charts and a Pine Script scanner. The UI is a Vite + React +
TypeScript app; there is no private backend and no API key.

## Stack

- Vite 8, React 19, TypeScript, Tailwind CSS v4
- Base UI, Lucide, Sonner, Geist Sans / Geist Mono
- `@luxalgo/vela` workspace; data comes from the venue sidecar
- `@screener/pine-engine` (local MIT compiler and runtime) for Pine Script
  indicators, the scanner, and the AI debug worker
- Monaco Editor and Pine language support from the local
  `@screener/pine-editor/monaco` entry, loaded lazily with the editor chunk
- The local MIT `pine-script-syntax-highlighter` checkout for hover docs,
  formatter, signature help, semantic tokens and the outline
- Public REST/WS market data from Binance and OKX, plus Bybit, Bitget,
  Hyperliquid, and Coinbase through their public APIs, normalized by
  `VenueAdapter`
- Electron shell for the desktop build: the bundled sidecar runs as a child
  process, and the app uses a custom title bar with an application menu.

The app resolves `@luxalgo/vela`, `@screener/pine-engine` and
`@screener/pine-editor` to the local `../Vela`, `../pine-engine` and
`../pine-editor` checkouts, so chart, engine and editor changes run live. A
Vite bundles the chart engine, scanner and debug workers from source.

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

The public-data sidecar runs separately in development:

```bash
npm run sidecar
# http://127.0.0.1:8787/health
```

### AI assistant

Open **Settings → AI assistant** and fill in a base URL, model and key. The
sidecar stores them in your user profile (`%APPDATA%\screener-v2\ai.json`),
never in the browser, and applies them without a restart. **Clear** removes the
file and disables the sidebar. Add a Whisper-compatible transcription model to
enable the microphone.

Any OpenAI-compatible endpoint works: OpenRouter, a local Ollama/LM Studio, or a
provider API. The model needs tool calling; vision is optional but required for
questions about the chart image.

The sidebar keeps every chat until you delete it. `Chat` / `All chats` tabs:
history searches titles and chart context, groups chats by date, renames inline
and deletes. After the first reply it generates a short title in the user's
language, falling back to the first prompt. The composer accepts pasted, dropped
or picked images and text files, dictated prompts and an optional **Chart**
capture that attaches the active chart image. A run's activity is folded into a
`Used N …` line: expand it for the Thoughts and tool cards, and expand those
further for details. The final answer stays visible. The composer also picks the
model and reasoning level. The assistant creates a new indicator or strategy in
a fresh buffer and applies it to the chart; when the editor holds an unsaved
draft, it asks whether to save, discard or cancel before replacing the buffer. Every Pine indicator's legend
row has a sparkles action that opens the sidebar already targeting that script;
the target is shown under the chat tabs and survives switching Pine tabs.

Environment variables still work and win over the stored settings:

```bash
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=google/gemini-2.5-flash
AI_API_KEY=sk-or-...
AI_TRANSCRIBE_MODEL=whisper-1   # optional, enables the mic
npm run sidecar
```

A local server needs no key: `AI_BASE_URL=http://127.0.0.1:11434/v1` with
`AI_MODEL` set to an installed model.

## Desktop build

```bash
npm run electron:start   # build the app + sidecar, launch Electron
npm run electron:pack    # release/win-unpacked/Screener.exe
```

The packaged app starts the bundled sidecar as a child process on
`127.0.0.1:8787` and serves the UI from a stable local port, so tabs, the
indicator library, and the Vela workspace persist between launches. The window
size, position, and maximized state also come back; a geometry from a monitor
that is no longer connected falls back to the default size, and an oversized
saved window is clamped to the monitor's work area. To run a headless check,
launch `Screener.exe --smoke`: it loads the app, waits for the table, writes a
JSON result, and exits non-zero if the table stays empty.

The About dialog shows the running build as `major.BUILT.HASH`: the package
major, the executable's build minute in UTC, and the short git commit
(`-dirty` when the tree had uncommitted changes). The `--smoke` result includes
the same `build` string.

## What it does

- Binance, OKX, Bybit, Bitget, Hyperliquid, and Coinbase instruments. The
  picker lists all venues, sorted by ticker across exchanges; a chart opens the
  venue of the selected ticker. Coinbase is spot; the rest are perpetuals.
- One multi-venue screener table with a venue checkbox filter, a leading
  `Venue` icon column, and a `perp` / `spot` badge per row. A row click opens the
  matching venue's chart. The sidecar watches every instrument whose 24h quote
  volume clears the threshold, so there is no row cap. Clicking a column header
  cycles descending, ascending, and unsorted.
- Screener metrics: Range 24h, 24h volume change, RVOL against the previous
  `RVOL days` windows, session VWAP z-score, and Wilder RSI on the configured
  technical timeframe (15m, 30m or 1h). Quick filters pick oversold (`RSI <30`),
  overbought (`RSI >70`), unusual volume (`RVOL ≥1.5`) and price above/below
  VWAP. The sidecar keeps one merged candle series per watched instrument, updates
  it from the venue's kline stream (Coinbase through a REST tail) and pushes
  batched row patches to the browser every two seconds; the browser only renders.
- Multi-chart Vela workspaces: `1`, `2×1`, `1×2`, `2×2`, `4×2`; cells keep their
  own symbol and timeframe, and the active cell survives a reload. Panning is
  session-only: a reload frames the latest bars at the same zoom level, keeping
  the chart's configured right margin.
  Dragging a chart into the past or zooming out loads older history in 500-bar
  steps, with a loading badge in the cell. The leftmost button of the chart
  toolbar's right group maximizes the selected chart over the widget and restores
  the grid on a second click.
- Screener table with search, gainers/losers and metric filters, sorting,
  resizable and reorderable columns, and per-row actions. Screener, Pine,
  Library, and Alerts
  open as Vela side panels from the chart's right sidebar; the open panel and
  width persist, and script alerts are session-only. The strategy dock sits at
  the foot of the chart column, under the range presets; the drawing toolbar and
  the right rail keep their full height. It resizes with a drag handle, collapses
  to its header, and keeps its state across reloads.
- Favorites: named lists managed from the star popover in the screener toolbar.
  `Default` is the default list; star a symbol to add it to the active list.
  Lists are stored at `screener.favorites.v2` per instrument
  (`venue:kind:nativeId`), and the old `screener.favorites` key folds into the
  default list. Create, rename, clear, or delete lists; import a JSON/text file
  into the active list; export every list as JSON. The star button beside the
  list dropdown shows only the active list, and the metric filters and search
  still apply within it. A symbol below the volume threshold is not fetched, so
  it does not appear there.
  The active list name labels the favorites button in the screener toolbar.
- Pine editor with tabs, presets and Monaco highlighting, completions, signature
  help, folding, search, semantic colors, outline, formatting, rich hover docs,
  context actions (Go to Definition, Discard, New tab, Open script, Save,
  Toggle console) and lint. Apply a script to the active chart or all charts in
  the workspace; an on-chart script updates in place and keeps its inputs and
  settings. The chart engine runs in a module worker, so a heavy script does not
  block the UI. Scripts can draw plots, hlines, fills, markers, lines, boxes,
  labels, tables and candles, and recolor chart candles with `barcolor`.
  `request.security` reads higher timeframes, lower intrabar data, and foreign
  instruments such as an SMT pair. An applied script reopens with its saved
  settings after a reload.
- Strategies: `strategy.entry`, `order`, `exit`, and `close` run as a backtest
  with trade markers on the chart and a dock under it showing net P&L, the five
  summary metrics and the equity curve. The viewer opens `Performance` (five
  metrics and a large equity curve) and `Trades Log` (entry, exit, size, net and
  cumulative P&L). Alerts from `alert()` and `alertcondition()` land in the
  Alerts panel once per bar per call site.
- Named layouts: save the full workspace (grid, markets, indicators, drawings,
  applied script), open it in a new tab or load it here, update, rename,
  duplicate, and import or export JSON. Updating a saved layout asks before
  overwriting it; `Duplicate…` keeps a copy of the active layout. The `Layouts`
  button sits in the chart toolbar right after Maximize.
- Saved indicator library stored in localStorage. Save, rename, duplicate, and
  delete scripts; a duplicate appends `copy` to the library name and the
  top-level `indicator(...)` / `strategy(...)` title. The same saved script can
  be added to a chart more than once; `On chart` is informational. Export or import `.pine`
  files and the JSON library. Saved scripts also appear in the app's `Indicators`
  window under `My scripts`, next to `Built-in` and the Library.
- `Indicators` window: a three-pane picker with search across names, families
  and descriptions. It opens on `My scripts`; hovering or selecting a saved
  script row reveals `Source code` and `Delete script`. `Source code` opens the
  script in its own Pine tab or activates the existing one; a dirty target asks
  whether to save or discard before switching. Delete removes clean editor
  copies and keeps dirty ones as drafts. `Yours` holds favorites, recent
  items, saved scripts and `Bring a script`; `Built-in` lists the chart engine's indicators; `Library`
  has Discover, all 845 bundled indicators and family filters. Results show
  preview cards, the right pane shows details, and `Add` fetches the full Pine
  source on demand, saves it with its original licence header, and adds it to
  the chart.
- Favorite indicators have a topbar shortcut too: the caret attached to
  `Indicators` opens the favorite list. Clicking one adds it to the active
  chart; `Manage in Indicators` opens the picker.
- Source button on every Pine indicator legend row: opens the exact script Vela
  is running in the editor, and selects the matching saved indicator.
- Settings templates: the indicator gear dialog and the chart settings dialog
  have a `Template` menu that saves the current inputs and properties, or the
  whole chart configuration, under a name and reapplies it later. Templates stay
  in localStorage.
- AI sidebar on the left, outside the Vela dock, so it stays visible next to the
  chart and the Pine editor. Its toggle sits at the top of the chart's left
  drawing toolbar, above the cursor tool. Chats are kept until deleted, and accept images,
  text files and dictation. The assistant reads the script, rewrites the editor
  buffer, runs a debug pass on the active chart (errors, warnings, plot values,
  vars) and receives the chart as an image when `Chart` is on. It reads charts,
  writes Pine scripts and debugs them on the active chart. It
  works against any OpenAI-compatible model; the key stays in the sidecar.
- Scanner runs the same script over closed candles in a Web Worker and adds the
  last plot values as table columns. It walks the checked venues sequentially;
  one venue's failure does not stop the rest.

## Notes

- Vela is Apache-2.0; its in-chart attribution mark stays enabled.
- Monaco Editor and the local Pine engine and editor packages are MIT. The
  formatter, signature help, semantic tokens and outline use the MIT
  `pine-script-syntax-highlighter` checkout.
- Indicators imported from the LuxAlgo Library keep their own licence header
  (usually CC BY-NC-SA 4.0) and are stored with it intact. Refresh the bundled
  catalog with `npm run library:catalog`.
- The app reads public market data only. It does not trade.
- The sidecar exposes public Binance, OKX, Bybit, Bitget, Hyperliquid, and
  Coinbase data through one `VenueAdapter` per venue and a shared cache. The table, scanner, and Vela
  charts use the sidecar only; there is no direct exchange path in the browser.
  Charts stream live candles over `ws://127.0.0.1:8787/stream`; the sidecar keeps
  one stream per symbol/timeframe and fans it out to every chart. Binance, OKX,
  Bybit, Bitget, and Hyperliquid stream over WebSockets; Coinbase uses one REST
  poll per second per stream. If a venue socket stays silent, the sidecar falls
  back to the same REST polling until a bar arrives. The instrument picker lists
  every venue and opens the selected exchange's chart.
