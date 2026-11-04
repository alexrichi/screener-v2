# Screener v2

A multi-venue crypto screener (Binance, OKX, Bybit, Bitget, Hyperliquid,
Coinbase) with Vela charts and a Pine Script scanner. The UI is a Vite + React +
TypeScript app; there is no private backend and no API key.

## Stack

- Vite 8, React 19, TypeScript, Tailwind CSS v4
- Base UI, Lucide, Sonner, Geist Sans / Geist Mono
- `@luxalgo/vela` workspace; data comes from the venue sidecar
- `@luxalgo/vela-pinets` + `pinets` for Pine Script indicators and the scanner
- CodeMirror 6 (`@uiw/react-codemirror`) with a Pine language mode from the
  local Vela-pinets `editor` entry
- Public REST/WS market data from Binance and OKX, plus Bybit, Bitget,
  Hyperliquid, and Coinbase through their public APIs, normalized by
  `VenueAdapter`
- Electron shell for the desktop build: the bundled sidecar runs as a child
  process, and the app uses a custom title bar with an application menu.

The app resolves `@luxalgo/vela` and `@luxalgo/vela-pinets` (engine and editor) to
the local `../Vela` and `../Vela-pinets` checkouts, so chart, engine and editor
changes run live. A small Vite plugin inlines the Pine worker from source.

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

The sidebar keeps every chat until you delete it. The default assistant-ui chat
has `Chat` / `All chats` tabs: history searches titles and chart context, groups
chats by date, renames inline and deletes. After the first reply it generates a
short title in the user's language, falling back to the first prompt. The
built-in chat (the `Columns2` toggle, or `Show app chat` in the chat menu) keeps
its own history with titles from the first message. Both accept pasted, dropped
or picked images and text files, dictated prompts and an optional **Chart**
capture that attaches the active chart image. A run's activity is folded into a
`Used N …` line: expand it for the Thoughts and tool cards, and expand those
further for details. The final answer stays visible. The assistant-ui composer
also picks the model and reasoning level; the agent mode (Assistant, Chart
analyst or Pine developer) sits just below it and changes the system prompt and
tools.

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
indicator library, and the Vela workspace persist between launches. To run a
headless check, launch `Screener.exe --smoke`: it loads the app, waits for the
table, writes a JSON result, and exits non-zero if the table stays empty.

## What it does

- Binance, OKX, Bybit, Bitget, Hyperliquid, and Coinbase instruments. The
  picker lists all venues, sorted by ticker across exchanges; a chart opens the
  venue of the selected ticker. Coinbase is spot; the rest are perpetuals.
- One multi-venue screener table with a venue checkbox filter, a leading
  `Venue` icon column, and a `perp` / `spot` badge per row. A row click opens the
  matching venue's chart. `topN` and the volume floor apply per venue before the
  lists merge. Clicking a column header cycles descending, ascending, and
  unsorted.
- Multi-chart Vela workspaces: `1`, `2×1`, `1×2`, `2×2`, `4×2`; cells keep their
  own symbol and timeframe. Dragging a chart into the past or zooming out loads
  older history in 500-bar steps, with a loading badge in the cell. The header
  button left of `Alerts` maximizes the selected chart over the widget and
  restores the grid on a second click.
- Screener table with search, gainers/losers filters, sorting, resizable and
  reorderable columns, and per-row actions. Screener, Pine, and Library open as
  Vela side panels from the chart header; the open panel and width persist.
- Favorites: named lists managed from the star popover in the screener toolbar.
  `Default` is the default list; star a symbol to add it to the active list.
  Lists are stored at `screener.favorites.v2` per instrument
  (`venue:kind:nativeId`), and the old `screener.favorites` key folds into the
  default list. Create, rename, clear, or delete lists; import a JSON/text file
  into the active list; export every list as JSON. Favorites stay visible in the
  `Favorites` tab even when a symbol falls outside `topN` or the volume filter.
  The active list name labels the favorites button in the screener toolbar.
- Pine editor with presets and CodeMirror highlighting, completions, folding,
  search, and lint. Apply a script to the active chart or all charts in the
  workspace; an on-chart script updates in place and keeps its inputs and
  settings.
- Saved indicator library stored in localStorage. Save, rename, duplicate, and
  delete scripts; export or import `.pine` files and the JSON library. Saved
  scripts also appear in the app's `Indicators` window under `My scripts`, above
  the built-in catalogue.
- `LuxAlgo` tab in the `Indicators` window: search 845 public Library indicators
  bundled with the app, browse preview cards with family and date, and add one
  to the chart. The full Pine source is loaded on demand, saved to the local
  library with its original licence header, and appears under `My scripts`.
- Source button on every Pine indicator legend row: opens the exact script Vela
  is running in the editor, and selects the matching saved indicator.
- Settings templates: the indicator gear dialog and the chart settings dialog
  have a `Template` menu that saves the current inputs and properties, or the
  whole chart configuration, under a name and reapplies it later. Templates stay
  in localStorage.
- AI sidebar on the left, outside the Vela dock, so it stays visible next to the
  chart and the Pine editor. Chats are kept until deleted, and accept images,
  text files and dictation. The assistant reads the script, rewrites the editor
  buffer, runs a debug pass on the active chart (errors, warnings, plot values,
  vars) and receives the chart as an image when `Chart` is on. Agent presets
  switch between general, read-only chart analysis and Pine development. It
  works against any OpenAI-compatible model; the key stays in the sidecar.
- Scanner runs the same script over closed candles in a Web Worker and adds the
  last plot values as table columns. It walks the checked venues sequentially;
  one venue's failure does not stop the rest.

## Notes

- Vela is Apache-2.0; its in-chart attribution mark stays enabled.
- Vela PineTS and PineTS are AGPL-3.0. This app is intended for private use;
  distributing or hosting it triggers AGPL obligations or requires a commercial
  license.
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
