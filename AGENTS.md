# Agent Guide

Working guide for an AI agent contributing to **Screener v2**: how to analyze
requests, implement, test, verify, and avoid regressions. Throughout this file,
**"the user"** means the human directing the work.

Screener v2 is a multi-venue crypto screener (Binance, OKX, Bybit, Bitget,
Hyperliquid, Coinbase): Vela charts, Pine Script indicators and scans, and a
compact table in a single Vite app. It uses public market data only. There is no
backend, auth, order execution, Electron shell, or Nautilus integration yet.

---

## Before you start

1. **Scratchpad.** Create `.scratchpad/` at the repo root when you need temporary
   notes, scripts, or captures. It is gitignored and local only. Never reference it
   from repo code, tests, or docs.

2. **Browser capability.** Confirm you can drive and inspect a real browser. Vela
   rendering, the scanner worker, persistence, and the table are only truly verified
   in a browser. If you cannot drive one, say up front that verification is weaker.

3. **Scope.** Keep changes inside this repo. Reading peer repos such as
   `../Vela`, `../pine-engine`, and `../pine-editor` is fine; do not modify them
   without explicit permission.

4. **Data.** The app reads Binance public REST endpoints. No API key or secret is
   needed. If Binance is unreachable or geo-blocked, that is an environmental
   failure, not a UI bug.

---

## Output style

Write short, direct answers in the Google developer documentation style: active
voice, present tense, concrete. Lead with what changed and what you verified. Do not
round "should work" up to "works".

---

## Working loop

For anything beyond a trivial edit:

1. **Understand before touching code.** Trace the actual flow through `App.tsx`,
   `VelaWorkspaceHost.tsx`, `lib/binance.ts`, and the component the request touches.
   The output of this step is where the change belongs and what the real decisions are.

2. **Settle open decisions before implementing.** Research first, recommend a default,
   and let the user redirect. Ask before coding, not halfway through.

3. **Make the smallest correct change at the right seam.** Reuse existing helpers,
   primitives, and state instead of adding a parallel path. Do not duplicate Binance
   fetching or Vela lifecycle code in a component.

4. **Gate it** (see _The gate_).

5. **Prove it in the real runtime** (see _Testing and verification_).

6. **Diagnose root causes.** Reproduce, capture, then fix. Re-check your own output
   adversarially.

7. **Present, do not commit.** Implement, gate, verify, present the result, and wait
   for explicit approval before committing.

---

## The gate

A change is not done until these checks pass together:

- `npm run typecheck` — TypeScript is clean.
- `npm test` — Vitest passes, including a targeted test for new pure logic.
- `npm run build` — the app and worker bundle build.

When `../pine-editor` or `../pine-engine` changes, also run that package's
`npm run typecheck` and `npm test`.

There is no `npm run lint` script yet. Do not claim one exists. If you add ESLint,
add the script and include it in this gate.

For changes that touch UI, the scanner, Vela, persistence, or layout, also run the
app and verify the behavior in a browser. A green suite does not prove a new chart
pane, a working scan, or a persisted layout.

---

## Architecture

```
src/
  App.tsx                         composition root; persisted app state and scan orchestration
  components/
    AppHeader.tsx                 brand, workspace tabs, "+" picker, status
    AiSidebar.tsx                 left AI sidebar: assistant-ui chat, history, attachments,
                                  dictation
    AiChatHistory.tsx             chat history: search, date groups, inline rename, delete
    AiChatTabs.tsx                current-chat / all-chats tab strip
    AiModelPicker.tsx             composer model catalog and reasoning level
    AlertsPanel.tsx               per-tab script alerts in the right rail
    StrategyEquity.tsx            strategy net P&L curve (zero line, downsample)
    StrategyPanel.tsx             app-owned strategy dock under the chart
    AssistantUiThread.tsx         assistant-ui chat over the same tools
    assistant-ui/                 assistant-ui registry kit (thread, composer, tool UI)
    ui/                           shadcn shims used by the registry kit (Base UI)
    VelaWorkspaceHost.tsx         Vela workspace per tab; cells, active-cell sync, Pine apply,
                                  source-code legend action
    ScreenerTable.tsx             server-owned market table, metric columns, quick filters,
                                  favorites, column actions
    PinePanel.tsx                 script editor with tabs, saved scripts, apply and scan controls;
                                  lazy-loads the Monaco editor from `@screener/pine-editor/monaco/react`
    LibraryPanel.tsx              saved indicator list, import/export and actions
    SettingsDialog.tsx            watch threshold, metrics timeframe, scan defaults
  hooks/
    useScreener.ts                server-owned screener: snapshot, WS patches, viewport, config
    useDictation.ts               microphone recording and sidecar transcription
  lib/
    ai/debug.worker.ts            disposable pine-engine debug run over sidecar bars
    ai/debugRun.ts                debug worker lifecycle and timeout
    ai/debugResult.ts             engine run to ScriptRunSummary mapping
    ai/model.ts                   OpenAI-compatible provider + config and transcription calls
    ai/title.ts                   one-shot generated title for assistant-ui chats
    ai/tools.ts                   app tools: script, chart context, debug run
    ai/target.ts                  script/chart target carried by AI tool calls
    ai/uiChats.ts                 assistant-ui sessions, migration, groups, title fallback
    utils.ts                      shadcn `cn` helper for registry components
    alerts.ts                     session-only per-tab chart alerts
    binance.ts                    public futures REST, symbol/timeframe mapping, klines
    format.ts                     price, percent, volume, funding, layout labels
    indicatorLibrary.ts           .pine library model, storage key, validators, import
    indicatorState.ts             saved instance ids, input deltas, stored-script validation
    indicatorPicker.ts            picker entries, relevance filter, favorites/recents
    luxalgoLibrary.ts             bundled LuxAlgo catalog, family labels, source fetch
    favorites.ts                  named favorite lists, migration, import/export
    pineDraft.ts                  saved/source dirty comparison and starter templates
    pineTabs.ts                   Pine editor tab model, source normalization, legacy migration and validators
    pineVela/engine.ts            Vela ScriptingEngine: worker orchestration and result mapping
    pineVela/session.ts           Pine run state: bars, inputs, security caches, probes
    pineVela/engine.worker.ts     module worker: compile and run sessions off the main thread
    pineVela/protocol.ts          structured-clone worker messages
    pineVela/workerClient.ts      worker lifecycle and needs/resume fetching
    screenerClient.ts             screener snapshot/config REST calls and row patch merge
    screenerMetrics.ts            Range 24h, VolΔ24h, RVOL, VWAPσ and Wilder RSI formulas
    universe.ts                   scan target grouping and the favorites key
    velaAi.ts                     AI rail toggle attached to Vela's drawing toolbar
    velaLayouts.ts                topbar Layouts action and popover bridge
    velaMaximize.ts               topbar widget actions bridged to ws.maximizeCell
    velaPanels.tsx                Vela side-panel registration and React portal bridge
    velaScripts.ts                per-cell persistence for external script indicators
    usePersistedState.ts          localStorage-backed state with runtime validation
    view.ts                       default screener view and its validator
    scaleState.ts                 zoom payload validation and cache rules
    velaScale.ts                  cell-scope persisted zoom level
    velaTheme.ts                  dark/light Vela theme matching the app tokens
    strategyRuns.ts               per-tab strategy runs fed by chart.on('script:run')
  scan/
    extractPlots.ts               last finite plot value for the scan table
    scan.worker.ts                Pine engine scan worker
    useScanner.ts                 worker lifecycle, progress, cancel, errors
  scripts/presets.ts              built-in Pine presets
  data/luxalgoCatalog.json        bundled LuxAlgo Library catalog (generated)
  ui/                             tokens, primitives, overlays, theme provider
  types.ts                        shared app/data/worker types
  venues/
    types.ts                      VenueAdapter, Instrument, trading ports
    instrument.ts                 display/key normalization (.P, spot slash rule)
    catalog.ts                    venue ids, labels, sort and selection validation
    venueIcons.tsx                shared exchange icons and Vela picker CSS hook
    rateLimit.ts                  venue-agnostic weight/request gate
    registry.ts                   adapter registry
    binance.ts                    Binance public-data adapter
    okx.ts                        OKX public-data adapter (siebly okx-api)
    bybit.ts                      Bybit public-data adapter (siebly bybit-api)
    bitget.ts                     Bitget public-data adapter (siebly bitget-api)
    hyperliquid.ts                Hyperliquid public info adapter
    coinbase.ts                   Coinbase Exchange spot adapter
    sidecar.ts                    HTTP client for the venue sidecar
    sidecarStream.ts              browser WebSocket client for live venue bars
    vela.ts                       Vela DataProvider for one venue, backed by the sidecar
    fake.ts                       deterministic conformance adapter
sidecar/
  server.ts                       public-data HTTP + WebSocket server; one hub per venue
  ai.ts                           AI key-injecting proxy for an OpenAI-compatible model
  hub.ts                          one adapter per venue; shared caches/fan-out
  luxalgo.ts                      LuxAlgo Library source fetch and cache
  screener.ts                     server-owned watched table: activation, warm-up, metrics, patches
  stream.ts                       Binance kline WS plus a REST-polling stream for
                                  venues without a WS feed
  ws.ts                           generic ref-counted venue WebSocket stream
  venueStreams.ts                 OKX / Bybit / Bitget / Hyperliquid subscription specs
electron/
  main.cjs                        desktop shell: sidecar child, static server, window
  preload.cjs                     narrow title-bar/window IPC bridge
  build-sidecar.mjs               esbuild bundle of sidecar/server.ts for packaging
scripts/build-library-catalog.mjs regenerates src/data/luxalgoCatalog.json
test/market.test.ts               pure logic tests
test/venues.test.ts               instrument, adapter and rate-limit tests
```

### State and data flow

- `App.tsx` owns tabs, active tab, view, settings, theme, saved
  indicator library, and scan results. Persisted keys are `screener.*`; the
  library lives at `screener.indicators.v1`; workspace state is keyed per tab as
  `screener-v2:ws:<tabId>`.
- The library stores raw `.pine` source only. Duplicate appends `copy` to the
  library name and rewrites the top-level `indicator(...)` / `strategy(...)`
  title to the same name. Saved scripts are app-owned: the host adds them as
  external indicators under `saved-<id>:<instance>`, and every Add appends a new
  handle (the saved item is a template), so the same script can sit on a chart
  more than once. The custom
  `IndicatorWindow` lists `My scripts` from app state plus `Built-in` from
  `cell.libraryRows()` and opens on `My scripts`; each saved row reveals
  `Source code` and `Delete script` on hover or selection (`Delete` confirms and
  clears the current editor item). There is no Vela `indicators` manifest and no
  `setIndicators` seam. `lib/velaScripts.ts` registers a cell-scope state
  handler (`screener.scripts`) that persists every external script except the
  applied `screener-pine`, so saved and Library-added indicators survive tab
  switches and reloads. Vela's native picker is replaced by the app's own
  `IndicatorWindow`, opened by a topbar action registered under the built-in
  `'indicators'` slot. Vela still owns the button, `/` and mobile stop, but never
  constructs its picker.
- `IndicatorWindow` is a three-pane picker modelled on Vela Pro: left sources
  and families, center results, right details. `lib/indicatorPicker.ts` builds
  one entry list from `IndicatorRow` and the bundled catalog, filters it with a
  name/family/description relevance order, and keeps `Favorites`/`Recent` in
  `screener.indicators.picker.v1`. Native `On chart` is matched by `nativeType`
  because the chart legend title can differ from the picker name (Connors RSI
  shows as CRSI). `Add` closes the window; `Ctrl/⌘+Enter` keeps it open;
  `↑/↓`, `F`, and `Esc` work from the search field. `Bring a script` opens
  Electron's native dialog with `Pine Script` / `Text files` / `All files`
  filters (the browser fallback is a file input), imports through
  `importLibraryFile` and closes. There is no Concepts source
  and no Ask AI action.
- The `Discover` / `All scripts` views of `IndicatorWindow` read the bundled
  catalog (`src/data/luxalgoCatalog.json`, 845 indicators, refresh with
  `npm run library:catalog`). They render preview cards through Vela's public
  image-resizing proxy. `Add` fetches the full Pine source through the sidecar
  (`/library/source`, 24 h in-memory cache), stores it in the local library with
  the canonical Library URL in notes, and attaches it as its own external
  indicator (`library-<codeId>`). Several Library scripts can sit on one chart
  and the tab's own Pine script is not replaced. Sources are fetched on demand,
  never bulk-copied into the repo.
- The screener table is server-owned. `sidecar/screener.ts` polls venue tickers
  (`VenueHub` owns the adapters, caches and in-flight de-duplication), watches
  every instrument whose 24h quote volume clears `minVolume`, and backfills
  `rvolDays + 1` days of `metricsTimeframe` candles for each one. Watched
  instruments subscribe to their venue's kline stream in batches; Coinbase has no
  candle WS, so its rows refresh through a slow REST tail. `topN` no longer trims
  the table or the scanner. Ticker polls run in parallel: every venue applies its
  own tickers as soon as its call settles, so one slow or failing exchange does
  not delay the others' activation. Warm-up and refresh keep one queue and one
  slot pool (4) per venue, so a venue's rate limiter never holds another venue's
  rows; warm-up runs as `background` work, visible rows first, then the
  highest-volume rows per venue. The browser sends its top 100 row keys as
  `screener.viewport`. The service computes Range 24h, VolΔ24h, RVOL, VWAPσ and
  Wilder RSI (`lib/screenerMetrics.ts`) and pushes batched patches every 2 s.
- `useScreener` fetches `/screener/snapshot` once, then reads `screener.patch`
  frames from the single `/screener` WebSocket and merges them by `instrument.key`
  in 24h-volume order. Configuration (threshold, timeframe, RVOL days, RSI
  period, checked venues) is replayed on reconnect and on every change; dropping
  a venue unsubscribes and removes its rows, and the remaining rows stay. The
  service starts on the first snapshot or socket connection, not when the sidecar
  boots. A failed venue
  keeps the other venues' rows and surfaces as a per-venue warning. OKX has no
  bulk REST funding endpoint: its adapter keeps one `funding-rate` WebSocket
  subscription for every USDT swap and reads the cached rates into
  `VenueTicker`. A socket failure leaves funding null without failing the tickers.
- Vela charts use `SidecarVelaProvider(venueId)`, one provider per entry in
  `venues/catalog.ts`. History, live candles and ranged backfills all go through
  the sidecar: the provider sends the requested depth (and `to` for older
  windows), the adapter paginates past the venue's page size inside the shared
  limiter, and `VenueHub` caches the result. A venue socket that stays silent for
  1.5 s falls back to **one** REST poll per second per stream, fanned out to every
  chart; Coinbase has no candle WS yet, so it uses the REST-polling path from the
  start.
  The browser polls only while its sidecar socket is down. The picker pool is
  sorted by ticker across venues (`registerSymbolRanking`), not grouped by
  exchange; registering a ranking also retires the built-in majors pin.
  There is no direct exchange path in the browser: if the sidecar is down, the
  chart keeps what it has and the table shows the error. Vela never fetches older bars
  on pan, zoom or resize, so the host watches `viewport:changed` and wheel-zoom-out,
  then raises the cell's depth by 500 bars (cap 100k) when the viewport reaches the
  oldest loaded bar (8-bar tolerance) or the zoom hits the loaded-depth limit. Since
  Vela 0.10.8 the zoom-out floor is a fixed 0.5 px per bar instead of "all bars fill
  the width", so a deep zoom-out passes the loaded series and extends the depth in
  500-bar steps until the view is covered; it stops at the floor, not per tick. A
  `ResizeObserver` also fills a cell whose width grew while its loaded series ends at
  the left edge: it asks for `depth * newWidth / oldWidth` (cap 100k) instead of
  re-framing. Vela keeps the bar spacing, so the older bars fill the extra width with
  no resize, refit or stretch. It waits for the next `history:complete` and shows a
  per-cell loading badge. The depth is preserved across symbol and timeframe switches,
  so the new series loads at the same bar spacing. `history:complete` with reason
  `genesis` stops that cell from extending.
- `App` keeps named favorite lists at `screener.favorites.v2`
  (`{ version: 2, lists, activeListId }`), keyed by `instrument.key`
  (`venue:kind:nativeId`). The `default` list (named `Default`) starts empty,
  can be renamed and edited, and cannot be deleted; other lists are created,
  renamed, cleared, and deleted from the star popover. Legacy
  `screener.favorites` items fold into the default list on first read. The active
  list name labels the favorites button, while the panel title stays `Screener`.
  Import adds every ticker to the active list; list names in the file are
  ignored. Export writes every list as JSON. The table always shows every watched
  row: a favorite below `minVolume` is not watched, so it is not fetched and not
  visible. The `All` / `Favorites` switch before the list dropdown shows only the
  active list and combines with the active quick filters and the search;
  `ScreenerView.favoritesOnly` carries that scope, and the old
  `filter: 'favorites'` document still reads as the same scope.
- A table row click opens `instrument.velaSymbol`, so the active cell follows the
  row's venue. The Vela host projects that change through `setSymbol`.
- The table columns are venue, symbol, last, 24h %, Range 24h, Vol 24h, VolΔ24h,
  RVOL (labeled with `rvolDays`), funding, VWAPσ and RSI (labeled with the
  metrics timeframe), then one column per scan plot. The quick filters are
  independent on/off chips — Gainers, Losers, RSI <30 / >70, RVOL ≥1.5 and
  above/below VWAP — combined with AND; turning one of an opposite pair on turns
  the other off, and no active chip means every row. They live in
  `ScreenerView.filters`, and an old single `filter` still reads as one chip. The
  `All` / `Favorites` switch before the list scopes the table to that list and
  combines with the active chips and the search. The search field lives in the
  `SYMBOL` header; the header still sorts when the field is not focused, and its
  clear button empties the query. A status bar under the table shows the shown /
  total row count. The venue filter lives at
  `screener.marketVenues`; unselected venues are not
  fetched. `Favorite`, `Venue` and `Symbol` are pinned at the left: `Favorite` is
  a narrow star-only column, `Venue` is icons only with a globe/sort header, and
  `Symbol` starts with a 16 px coin logo from the sidecar's `/icon/<code>`
  route (`loading="lazy"`). That route chains the symbol-logo S3 CDN, OKX,
  Binance, CoinCap, Financial Modeling Prep and Ledger, caches the first hit,
  and drops contract multipliers and venue suffixes (`1000PEPE`, `kPEPE` →
  `PEPE`; `BTC-USDT-SWAP`, `BTCUSDT.P` → `BTC`). Charts resolve the same route
  through the provider's `resolveSymbolIcon`, so the table and the chart agree;
  Vela needs it CORS-clean for the PNG export. Assets no source carries (some
  tokenized stocks and new listings) fall back to the base initial on a
  deterministic colour. `Symbol` keeps the
  search field in its header. Column sort cycles
  descending → ascending → unsorted; `ScreenerView.sort` is nullable.
- The app mounts one Vela host per **visited** tab and keeps it alive; inactive
  hosts stay in the DOM with `visibility:hidden` (size preserved), so their
  charts, engines and alerts keep running. Handles live in a
  `Map<tabId, handle>`; every app action targets the active tab. A tab mounts on
  first activation; closing it destroys its workspace.
- The Vela host listens to `state:changed`, `cell:active`, and `layout:changed`,
  debounces for 120 ms, and writes the active symbol/timeframe/layout back to the
  tab. Do not update state if the values are unchanged.
- A scan sends `targets: [{ venue, instruments }]` to `scan.worker.ts`. The worker
  walks venues sequentially, compiles the script once through
  `@screener/pine-engine`, fetches closed candles with bounded concurrency, runs
  the compiled program per instrument, and posts results keyed
  by `instrument.key` plus progress with the current venue. A venue failure or
  rate limit does not stop the remaining venues. The main thread only merges
  results and derives plot columns.
- The Pine editor is tabbed. Tabs live at `screener.pine.tabs.v1` as
  `{ id, script, savedId }`; `screener.pine.activeTab.v1` selects one, and the
  legacy `screener.pine.script` / `screener.pine.savedId` mirror the active tab
  for backups and the smoke run. The old single buffer becomes the first tab on
  first load. `New tab` adds a Pine editor tab, not a chart workspace tab;
  closing a dirty tab confirms. Each open tab owns a Monaco model keyed by its
  id; switching calls `setModel` with the saved view state, so undo/redo, cursor
  and scroll never cross tabs, and models of closed tabs are disposed. Sources
  are normalized to LF for dirty checks, tab lookup and saved-script plans, so a
  saved CRLF script does not open as a draft. The AI `new_script`, save and
  discard flows and the scan all target the active tab. Opening a saved script
  (chart legend source, picker `Source code`, Library edit/scan, import,
  duplicate) reuses its tab or creates one; it never replaces another tab's
  buffer. A dirty target asks Save changes / Discard changes / Cancel. Delete
  drops clean tabs for the deleted item and turns dirty ones into drafts. Add to
  chart and Library reveal never bind `savedId`.
- The applied Pine script is stored on the tab as `pineScript` / `pineAll`, with its
  input values in `pineInputs` and declaration-property overrides in `pineProps`
  (both kept current by `indicator:inputs`, which Vela emits for input and prop
  changes). Vela's external indicators are not persisted by the workspace
  document, so the host reapplies the stored script, inputs and props on mount.
- The visible time position is session-only: a reload frames the latest bars at
  the document's depth. The zoom level (visible bar count) persists per cell in
  `ext['screener.scale']` (`{ symbol, timeframe, bars }`) and is re-applied
  against the newest bar with the renderer's configured right margin
  (`margins.right`, in bars) added back, so a reload opens at the current time
  at the same zoom with the same right whitespace. Panning alone does not dirty
  the document; only a change in the visible bar count (zoom or cell resize)
  does. The
  restored `activeCellId` stays authoritative: the host only calls
  `setActiveCell` by symbol when that cell shows a different symbol.
- Scan results are session-only. Tabs, table view, settings, theme, the open Vela
  side panel, and the applied Pine script persist; scan rows and plot columns do not.
- The AI sidebar is a sibling of the Vela section, not a Vela panel, so it stays
  visible next to the chart and the Pine dock. `screener.ai.open` and
  `screener.ai.width` persist; chats live in `screener.ai.aui.v2`
  (`{ version: 2, sessions, activeId }`, capped at 30 chats and 200 messages each).
  The tool loop runs in the
  renderer (`AssistantUiThread`) because the tools need the live editor and
  chart; the sidecar only proxies the model call with `AI_BASE_URL`, `AI_MODEL`,
  `AI_TRANSCRIBE_MODEL` and `AI_API_KEY`. Tools are `get_chart_context`,
  `get_script`, `read_lines`, `edit_code`, `new_script`, `apply_script`,
  `run_script` and `apply_live`. Attached text files are
  folded into the prompt; images ride as image parts of the user message.
- The table view is global (`screener.view`), not per workspace tab.
  `settings.defaultLayout` applies to new tabs; existing tabs keep their own layout.
- Named layouts live at `screener.layouts.v1` (`{ version: 1, items }`). A layout
  is a full `ws.getState()` snapshot (grid, cells, markets, indicators, drawings,
  dock) plus the app-owned applied Pine script and its inputs. New tabs from a layout boot from
  a seeded `VelaStorage` only while they have no document of their own. The
  `Layouts` topbar action (`lib/velaLayouts.ts`) manages them; import/export is
  one JSON file and no candle data is stored. Saving is explicit; the tab itself
  still autosaves through Vela. The maximize actions are leftmost in the chart
  toolbar's right group (`order: -200`); `Layouts` follows (`order: -100`).
  `index.css` draws topbar hairlines around the Layouts action
  (`.vela-widget-action`); panel toggles live in Vela's right sidebar and use its
  own separators.

---

## Key invariants and gotchas

**Layout is a layout id, not a boolean.** Vela accepts `'1'`, `'2h'`, `'2v'`, `'4'`,
`'8'`, or a registered custom id. `false` removes the layout picker and pins one
chart. Keep the picker enabled: the default is `'1'`. Layout changes come from
Vela's own chart control; the host listens to `layout:changed` and writes the
active layout back to the tab. Do not add a second selector to the app header.

**Named layouts use Vela's state document.** `captureLayout` calls
`ws.getState()`; `applyLayout` gates the document through `sanitizeState` and
calls `ws.applyState()`. The applied `screener-pine` is external and absent from
the document, so applying removes it and reapplies the snapshot's script. The
maximize actions are registered with `align: 'right', order: -200`, so they take
the leftmost slots in the right cluster; `Layouts` (`order: -100`) follows them.
Widget actions only target the topbar and context menus (`WidgetActionTarget`);
the bottom bar is internal, so do not move Maximize there without a Vela API. A
seeded tab uses a `VelaStorage` that returns the seed only when no tab document
exists; after the first autosave (or on reload) its own document wins.

**Cell maximize is transient.** The app registers `screener-maximize` /
`screener-restore` topbar widget actions (`lib/velaMaximize.ts`) in the `actions`
slot, leftmost in the right cluster before `Layouts` and `Alerts`, bridged to
`ws.maximizeCell(active.id)` or `null`. They are hidden on a single-cell grid and
refreshed on `cell:maximized` and `layout:changed`. Siblings stay alive
underneath; the state is never persisted, and a layout switch or state restore
clears it.

**Seed cells, never pre-collapse.** Create the workspace directly with the tab's
layout and pass seeds for `main`, `alt`, and extra slots. Expanding later hydrates
`altSymbol` from those seeds. Do not seed a wider grid and collapse it: destroying
the extra cell calls the shared feed's `destroy()`, which cancels the surviving
cell's parked symbol wait while the provider index is still settling, and the tab
opens blank until the symbol or layout changes. A persisted workspace document
wins over seeds; if you change the seed policy, version or clear the workspace
keys rather than assuming old documents migrate.

**Restore the active cell explicitly.** After creating a workspace, match the tab's
symbol to a live cell and call `ws.setActiveCell(...)`. Otherwise a fresh tab can
open with the alt cell active while the tab label says the main symbol.

**Vela external indicators are app-owned.** Add with
`cell.addExternalIndicator({ id: 'screener-pine', name, script })`. When
`screener-pine` is already on the cell, Apply updates it in place through
`handle.updateCode(source)`: same handle, same legend row, and the inputs and
props survive; Vela restores the previous code when the new one fails. Only a
missing indicator is added. The host returns `{ count, errors }` per chart, and
the panel reports the first error. Store `pineScript`, `pineName`, `pineAll`,
the applied script's input values `pineInputs` and property overrides
`pineProps` on the tab and reapply them on mount. `lastAppliedRef` prevents a
double apply when the tab state update and the imperative Apply happen together.
The script is TAB state, not chart state: removing `screener-pine` from the
legend (or the object tree) clears those tab fields through `onPineRemoved`, and
the host removes its siblings on other cells; otherwise a reload, an `Update
layout` (`tabPine(tab)`) or a layout switch applies it again. `applyLayout` sets
`pineSwapRef` while it swaps the old script for the snapshot's one, so the swap
is not mistaken for a user delete.

**Saved indicators are app-owned external scripts.** The library stores raw
`.pine` source only, never transpiled output. `addSavedIndicator(item)` adds it
through `cell.addExternalIndicator` with a fresh `saved-<id>:<instance>` id on
every Add; the same script can sit on the chart more than once. The custom
window lists these from app state and native indicators from
`cell.libraryRows()`. There is no `setIndicators` call and no Vela manifest for
user scripts. `lib/velaScripts.ts` persists the external scripts per cell (the
applied `screener-pine` is excluded and restored by the host), together with the
input/prop deltas and the hidden flag, so custom-indicator settings survive a
reload; keep that handler registered before any workspace is constructed.

**Settings templates are an app layer over Vela's dialogs.** `SettingsTemplateHost`
watches `.vela-ind-dialog` and `.vela-dialog--settings` and injects the shared
`SettingsTemplateMenu` into their footers, keeping the native Reset defaults in
the DOM but hidden. Templates live in `screener.settingsTemplates.v1`, scoped:
`indicator:<native|source-hash>` stores input deltas plus prop overrides; `chart`
stores the renderer config and the cell `requestedPriceStyle` so the chart type
survives a reload. Indicator dialogs keep a working copy and commit on OK, so
Save commits before capturing; chart settings are live, so the host adds
Cancel/OK and Cancel restores the open-time config plus requestedPriceStyle. On
Vela 0.10.7 the chart footer uses `.vela-sd-btn`; the app marks its OK with
`data-screener-primary` and styles it in `index.css`. Apply closes the dialog
before writing so stale working values cannot win. The old
`screener.indicatorTemplates.v1` is folded into the shared store on first load.
Vela Pro uses the same injection pattern; a Vela dialog markup change needs a
check here.

**The indicator window is app-owned.** `lib/velaIndicators.ts` registers a
topbar action under the built-in `'indicators'` id; this replaces Vela's native
picker, including its `/` and mobile entry points. The action only calls a
bridge into `App`, which renders `IndicatorWindow`. The window reads the active
cell's `libraryRows()`/`onChartRows()` (mapped to `IndicatorRow`) and adds via
`addFromLibrary(index)`. Do not build the native picker a second time, and keep
the original row indices: `libraryRows()` is the index space `addFromLibrary`
expects. The window opens on `My scripts`; a saved row reveals `Source code` and
`Delete script` on hover or selection. `Source code` opens that item in its own
Pine tab (or activates the existing one); a dirty target asks Save changes /
Discard changes / Cancel, and the picker closes. `Delete script` confirms,
removes the saved item, drops clean editor tabs and keeps dirty ones as drafts;
chart handles stay as snapshots. Native `On
chart` is derived from `onChartRows()[].nativeType`, not the
name: the legend title can differ from the picker row (Connors RSI → CRSI).
Indicator add/remove events call `ws.context().stateChanged()` so native and
external changes reach the workspace document before the next reload. The same
module registers `screener-indicator-favorites` as a caret attached to the
Indicators control in the topbar's left cluster. It opens the app's
`FavoritesMenu`, anchored to the action button; the menu and `IndicatorWindow`
share `indicatorPrefs` (`screener.indicators.picker.v1`). A favorite click adds
the native, saved or Library item and marks it recent; `Manage in Indicators`
opens the picker.

**LuxAlgo Library imports keep their licence.** The source comes verbatim from
the same public endpoint Vela's picker uses, including its header (MPL 2.0 or
CC BY-NC-SA 4.0). Never strip the header or relicense it; keep the Library page
URL in the saved indicator's notes. The bundled catalog holds display metadata
only.

**The legend source action uses Vela's public contribution seam.** The host
registers one `registerLegendAction` for Pine indicators and forwards
`LegendIndicatorInfo.source` plus the Library id parsed from its
`saved-<id>:<instance>` handle to `App`. `showSource` opens the saved item by
id first, then falls back to a normalized source match, so a CRLF copy or a
renamed handle still lands in the right tab. Do not add a parallel chart
button or reach into renderer internals.

**AI tools use an explicit script target.** `lib/ai/target.ts` carries
`{ pineTabId, savedId, name, workspaceTabId }`. `get_script` binds the active
Pine tab on first use and returns that target; `edit_code`, `apply_script`,
`apply_live` and `run_script` resolve the target by id, not the currently active
tab. `new_script` creates a fresh tab and returns its target. The AI sidebar
shows `Editing <name>` and can clear it. Closing the target makes the next tool
return an error instead of writing into another tab. The legend row's
`screener-ask-ai` action (sparkles, before Source code) resolves the script from
the clicked indicator and opens the sidebar with that target; native indicators
have no source and no action.

**The AI sidebar is renderer-side and keyless.** `lib/ai/model.ts` points an
OpenAI-compatible provider at `<sidecar>/ai/v1`; `sidecar/ai.ts` swaps in the real
key and model. The key lives only in the sidecar process and its settings file
(`%APPDATA%\screener-v2\ai.json`, or `AI_CONFIG_FILE`), written at mode 0600.
Keep that default in sync with Electron's `app.getPath('userData')`; a different
directory makes the dev sidecar and the packaged app read different keys. A blank
key keeps the stored one, and replacing a saved key requires `replaceKey: true`,
so a stray config POST cannot wipe it. Never move it into `VITE_*` env,
localStorage, or the bundle. `AI_BASE_URL` /
`AI_MODEL` / `AI_API_KEY` in the environment override the file, and the settings
route refuses to edit while they are set. `new_script` starts a new indicator or
strategy in a fresh buffer: it reports `needsDecision` with the draft's title and
size when the editor holds unsaved changes, and only creates after the user picks
`save`, `discard` or `cancel` and the model calls it again with `conflict`; a
saved draft updates its Library item or becomes a new one, so a new script never
overwrites someone else's draft. `apply_script`
only rewrites the editor buffer (undo works, nothing runs); `apply_live` applies
that buffer to the active chart through the same in-place path as the editor's
Apply button and returns the live `{ ok, error }`; `run_script` runs the same
source twice: on the active chart through `chart.runScript()` (the truth,
including the forming bar) and in a disposable worker over sidecar bars with
`@screener/pine-engine`, hard-terminated after 20 s. The worker uses the same
`PineSession` as the chart engine, so `request.security`/`security_lower_tf`
fetch lower and foreign series through the sidecar adapter instead of returning
`na`. The live probe also waits briefly for a follow-up run when the source
uses `request.security`, so the summary reports the final series, not the
provisional pass. It captures
`log.info/warning/error` lines and adds a second result to compare; the chart
probe removes its indicator again, so debugging leaves no legend row. The chart
image is attached as a `file` part of the **user** message, not as a tool
result: the OpenAI-compatible adapter drops
file parts from `role: 'tool'` messages, so a screenshot tool would silently
never reach the model.

**The AI rail toggle is an app attachment.** `lib/velaAi.ts` registers a widget
attachment that inserts `.screener-ai-rail` at the top of Vela's shared drawing
toolbar (`.vela-dtb`) and reattaches it when the toolbar is rebuilt; Vela has no
public left-rail action slot. The app header has no AI button. The button calls
`setAiBridge(toggleAi)` and paints from `setAiRailState(aiOpen)`. The rail is a
raised 36×44 tile with the sparkles mark and an `AI` label; a hairline under it
separates the toggle from the drawing tools. Collapsing the drawing toolbar
hides the rail with the tools. Re-check the `.vela-dtb` class on Vela upgrades.

**Attachments and dictation have provider limits.** Chat providers accept images,
not arbitrary files: the composer's attachment adapter folds text-like files
(`.pine`, `.txt`, `.md`, `.csv`, `.json`, `.log`) into the user prompt between
`--- attached file ---` markers, everything else is rejected with a toast. Images
are image parts of the current user message and are stripped from older turns
and from the persisted assistant-ui session (`lib/ai/uiChats.ts`) so localStorage
does not grow with base64. The mic records `audio/webm` with `MediaRecorder` and
posts it to the sidecar, which forwards it to `<base>/audio/transcriptions` using
the configured `transcriptionModel`; without that model the button is hidden.
Electron must keep the `media` permission handler in `electron/main.cjs`.

**Large scripts are read in ranges and patched, never re-sent whole.**
`get_script` sends the source inline only up to 40k chars; above that it returns
`{ chars, lines, truncated: true, source: null, outline }`, where the outline
maps declarations, functions, `request.security`, `var`/`varip` and `array.*` to
line numbers (`lib/ai/scriptOutline.ts`). The model then calls
`read_lines(from, to)` (400-line page, raw text, no prefixes) and applies fixes
with `edit_code`, a list of `{ oldStr, newStr }` patches validated by
`lib/ai/edits.ts` (each anchor must be unique). `apply_script` refuses sources
over 40k so a truncated model answer cannot overwrite a 126k file.

**The assistant-ui chat is the AI sidebar.** It renders the `Thread` from
`src/components/assistant-ui/`, installed with
`npx shadcn add https://r.assistant-ui.com/base/thread.json`. The chat fills the
sidebar width. Those files
use the `@/` alias (mapped to `src/`) and Base UI props (`render`,
`nativeButton`), so the shadcn `button`/`dialog`/`tooltip`/`avatar` shims in
`src/components/ui/` are Base UI, not Radix. `src/lib/utils.ts` provides `cn`,
`index.css` imports `tw-shimmer`, and `vite.config.ts` dedupes `react`/
`react-dom`. The assistant-ui chat is a set of sessions at
`screener.ai.aui.v2` (`{ version: 2, sessions, activeId }`); each session stores
its `ThreadMessageLike[]` with image parts stripped and text attachments folded
into the content, plus `title`, `titleSource`, `titleGenerated`, `context` and
timestamps. `AssistantUiThread` is controlled: the sidebar passes
`initialMessages` and receives `onSave`, and remounts it with
`key={session.id}` when the chat changes. The adapter parses the AI SDK's
`toUIMessageStream`/`readUIMessageStream`, and
`lib/ai/uiParts.ts` maps its parts: reasoning to the kit's Reasoning (labelled
`Thought`), text before the last tool call to reasoning (step notes), tool calls
to the tool cards, and the final answer text as text. `ChainOfThoughtGroup` folds
a run into one `Used N <tools>` line; `ToolActivityGroup` names each smaller tool
run, and the kit's `group-chainOfThought` honours the `ChainOfThought` slot.
The assistant keeps interim notes short. The tab strip switches between the current chat
and `All chats`; the history view has search, relative-date groups, inline rename
and delete, and hides chats with no messages. The first assistant reply triggers
one `generateText` title call in the user's language (fallback: the first user
prompt). The title call sets `reasoning: 'none'`; a reasoning
model otherwise spends the whole small token budget thinking and returns no
text. `titleSource: 'user'` stops later generated titles from overwriting a
manual rename. `screener.ai.aui.v1` is folded into one session and
removed on first load.

The composer keeps the model and reasoning pickers inside the action row, which
keeps a narrow sidebar readable. The same row carries the **Chart** toggle (the active
chart PNG rides on the newest user message, older file parts are dropped so the
payload does not grow) and the mic; the mic uses `useDictation`,
and it stays hidden until a transcription model is configured. The composer
component types are module-level constants fed by `AiComposerContext`; recreating
them when model/reasoning state changes makes assistant-ui remount the
composer and closes an open picker popover. The chosen model
(`screener.ai.model`) and reasoning level (`screener.ai.reasoning`) persist and
apply to the assistant-ui requests;
`default` means the configured model. `withModel` honors a concrete id sent by
the renderer, and `/ai/models` proxies the provider catalog with the sidecar's
key (OpenCode Go publishes it at `/inference/go/v1/models`, not under
`/openai/v1`). Reasoning maps to the SDK's `reasoning` option and then to
`reasoning_effort`; `auto` omits it. The title call always uses the selected
model with `reasoning: 'none'`.

**The right-hand panels are Vela side panels.** `lib/velaPanels.tsx`
registers `Screener`, `Pine`, `Library`, and `Alerts` with
`registerSidePanel` at import time and portals the React content into the
bodies Vela hands `mount`. Mounts are keyed `<tabId>:<panelId>`;
`openVelaPanel` targets the active tab and the portals render only into its
bodies. The shell runs with
`sidebar: { top: ['screener-screenshot', '|', 'screener', 'pine', 'library', '|', 'alerts'] }`
(Vela dev): the rail's top action downloads the screenshot of its own tab
(`setScreenshotTarget` maps `<tabId>` to `ws.downloadScreenshot()`), and the
topbar copy is hidden with app CSS so the `mod+alt+s` chord stays registered.
On desktop the panel toggles live in the right sidebar and the topbar keeps
Maximize and Layouts; mobile keeps the panel rows in its menu. `sidebar` is part
of Vela 0.10.7, so keep it. The dock's open panel and width live in the Vela
workspace document, not in `screener.dock.*`. Do not
reach into panel internals. `screener.panels.welcomed` only controls the
one-time Screener default.

**The strategy dock is a Vela docked strip.** `lib/velaStrategyDock.tsx`
registers a widget attachment; `ctx.dockStrip(el, { position: 'below-bottombar' })`
puts the React `StrategyPanel` at the foot of the chart column, under the range
presets. The drawing toolbar and the right rail keep their full height and only
the chart column shrinks; a flex sibling under the whole workspace would run
beneath those toolbars. The strip returns `null` when the tab has no strategy
runs. It defaults to 280 px, resizes with its drag handle (160–560), collapses
to a 36 px header, and the shared `lib/strategyDock.ts` store persists
`{ height, collapsed }` at `screener.strategy.dock` across tabs. The dock shows
the five metrics, the equity curve and the viewer action; the full ledger lives
in `Performance` / `Trades Log`, not in the dock. Do not register it as a Vela
side panel again.

Vela's workspace splitter strips carry an inline `z-index: 30`, above the
floating (25) and maximized (26) panels; `index.css` lowers them to 20 so a
maximized Pine editor keeps the pointer. Keep that override. Vela also inserts
its floating menu/popover layers before `.vela-ws-main` and leaves the positioner
at `z-index: auto` (the list inside carries the token z-index), so the chart
paints over an open timeframe dropdown. `index.css` lifts the workspace's
non-dialog `.vela-ui-layer` children to 50. Keep that override too. Vela's
in-chart settings dialogs (chart settings, indicator inputs, drawing settings)
are `contained: true` and appended to the chart cell; the cell clips them.
`index.css` pins the contained `dialog-backdrop`/`dialog-positioner` to the
viewport on desktop, so they overlay the workspace. The drawing quick toolbar
(`.vela-dpop`) is not a dialog and
stays cell-local. Re-check these overrides if Vela changes `data-slot` or
`data-contained`.

**Alerts are app-owned and session-only.** `lib/velaPanels.tsx` hides Vela's
topbar bell (`ctx.topbar.setVisible('alerts', false)` through a widget
attachment) and the rail's `Alerts` panel replaces it. `pine-engine` raises
`alert()` and `alertcondition()` on the current bar only; the chart adapter
passes them to `handlers.onAlert` once per bar per call site (the compiler
embeds a site id) so live ticks do not flood the list, and `freq_all` keeps the
message in the id. The host forwards every cell's `chart.on('alert')` to
`lib/alerts.ts`, which keeps the newest 50 per tab; the panel subscribes with
`useSyncExternalStore` and shows the active tab's list. Each workspace's panel
mount also keeps its rail button's count in sync through
`ctx.sidebar.setBadge('alerts', n)`, so background tabs badge too. Alerts from
background tabs are collected too, and each tab's panel shows its own list.
Nothing is persisted: a reload starts empty, exactly like Vela's bell. Do not
read Vela's private alert list or add a second bell.

**Strategies are engine runs surfaced by the app.** `pine-engine` executes
`strategy.entry/order/exit/close` with next-bar market fills, bracket exits
queued before their entry, one `closedtrades` ledger, and the declared
`initial_capital`. `lib/pineVela/strategy.ts` maps the result to Vela's
`StrategyState`, `StrategyTrade[]`, and `TradeExecution[]`; the adapter puts the
fills on `IndicatorModel.trades` (price-pane markers) and the state and trades
on the context snapshot. `lib/strategyRuns.ts` keeps the per-tab runs fed by
`chart.on('script:run')` and pulls the unbounded ledger only off the tick path,
so a live tick updates the metrics without re-reading the ledger. The engine's
per-bar equity curve rides the neutral state as an app-only `equityCurve` extra;
`StrategyPanel` draws it under the metrics and shows the newest 30 round trips,
while its viewer (`Performance` / `Trades Log`) shows the five Pro-style metrics,
the full curve and the whole ledger with a cumulative P&L column. Round-trip ids
compose the engine's exit order id with the entry/exit times: the engine reuses
the exit order id, so the raw id is not unique for React keys and markers. MFE
and MAE are absent because the engine's ledger does not expose them. The panel
is session-only; a reload replays the script and rebuilds the ledger. The
engine's strategy model is intentionally simple: no commission, slippage,
pyramiding limit, trailing stop, OCA group, or
intrabar fill ordering. Limits already through the open and gaps through a stop
fill at that bar's open, so every fill price stays inside its bar. A marketable
bracket leg therefore closes at the open, not at its target.
`strategy.closedtrades.<field>(n)` reads the ledger.

**Venue adapters own all exchange specifics.** `VenueAdapter` exposes only
`Instrument`, `VenueBar`, `VenueTicker` and the private `TradingPort`; the table,
scanner and Vela consume those shapes, never native ticker formats. Instrument
identity is `venue:kind:nativeId`; display is `BTCUSDT.P` for perps and
`BTCUSDT` / `BTC/USD` for spot. API requests use `nativeId`, Vela uses
`velaSymbol`. Rate limits are declared per adapter and enforced by
`RateLimiter`: a weighted token bucket (`burst = limit`, continuous refill)
with one scheduler. Under budget requests go immediately; over budget they are
paced evenly. Waiting for a bucket never holds a concurrency slot, and
`interactive` requests (charts, table, instruments) are granted before
`background` work. The scheduler also tracks our grants and the venue-reported
usage per window, so the full starting bucket cannot spend two windows' worth in
the first minute. Background work stops at 90% of a window's budget and
interactive work may spend the rest, so a screener cold start or a scan cannot
starve live charts. Binance's `x-mbx-used-weight-1m` header feeds
`RateLimiter.observe`: that IP-wide number counts as already spent in the
current window, and at 90% background work waits for the next window while
charts keep the tail; only a real 429 pauses every priority. An observation
that lands right after a window boundary is ignored because it belongs to the
closing window. Hyperliquid uses a
single `weight` bucket (`1200/min`):
`meta` / `metaAndAssetCtxs` cost 20, `candleSnapshot` costs 20 plus one per 60
returned candles, debited after the response. Binance keeps its per-request
klines weight and ticker weight 50. Trading credentials and SDKs belong in the
future sidecar, not the browser. Use the fake adapter for contract tests; do
not add `if (venue === ...)` branches to UI code.

**Charts may show the forming candle; the scanner never does.** `fetchKlines`
drops the forming candle using `closeTime <= Date.now()` unless the caller passes
`includeForming` (sidecar `?live=1`). Vela history and live polls pass it; the
scanner and the default `fetchBars` path do not.

**Timeframes arrive in several spellings.** Vela and Pine send canonical keys
(`15`, `60`, `D`) or aliases (`1D`, `4H`, `1h`); `binanceInterval` normalizes
them, with `1M` = month and `1m` = minute. Aggregated frames the venue does not
serve natively (`45`, `180`) are unsupported until the sidecar builds them.

**Plot output is the contract.** `extractEnginePlots` skips internal `__*` plots and takes
the last finite numeric value. Keep the cap (12) and the table's dynamic column
merge stable. Plot keys are the column identity; titles are display only. Titles
come from the parsed AST, because the transpiled metainfo carries only ids and
styles. A plot's color can be a series (`plot(x, color = cond ? a : b)`): the engine
evaluates it per bar, the first color becomes the series style, and later
deviations ride as per-point `SeriesPoint.color`; an explicit `color = na` becomes
a transparent override. A positional `plot.style_*` is honored like the named
argument. Static literal colors add no per-point payload.

**Vela only fills between series.** `hline()` becomes a `PriceLine`, so a
`fill(hline1, hline2)` (or `fill(hline, plot)`) would be dropped. The chart
adapter gives each filled hline a hidden constant series (`visible: false`, all
display surfaces off) as its anchor while keeping the visible price line. Do not
remove that mapping when touching the scene transform.

**The table is fixed-layout and horizontally scrollable.** Column definitions feed
both `<colgroup>` and the header/cell renderer. New columns must be added to the
definition list and the persisted order merge. The `Venue` column is fixed first
with icons only; its header is empty but sortable (globe plus sort glyph) and it
is not in the column picker. Keep numeric cells `font-mono` and `tabular-nums`,
and keep the sticky Symbol cell opaque in all states.

**The desktop window uses a custom title bar.** On Windows the native frame is
hidden (`titleBarStyle: 'hidden'` + `titleBarOverlay`), and `AppHeader` is the
title bar: `app-titlebar` is the drag region, interactive children are
`no-drag`, and `padding-right` reserves the native window controls. The
hamburger menu is Base UI `Menu` and drives existing React actions. Keep
`electron/preload.cjs` as the only main/renderer bridge; it exposes title-bar
theme and window actions, never `ipcRenderer` itself. The main process keeps the
window bounds and maximized flag in `window.json` under `userData`
(`electron/window-state.cjs`), restores them only when they still land on a
connected display, clamps the size to that display's work area and keeps the
title bar on screen, and saves on resize/move/maximize plus close. The smoke
result includes `titlebar.bridge`, `paddingRight`, `appRegion`, and `build`.

**The build stamp is per build.** `vite.config.ts` defines `__BUILD_STAMP__`:
`major` from `package.json`, `built` = Vite build minute (UTC), and `git` =
short HEAD plus `-dirty` when the tree is dirty. A packaged app replaces `built`
with the executable's mtime minute over `screener:build-built`, so a repack from
the same bundle still gets a new stamp. `lib/buildVersion.ts` formats
`major.BUILT.HASH`; the About dialog shows it and `<html data-build-version>`
carries it for the smoke result.

**Theme changes touch two files.** App tokens live in `src/index.css`; the Vela
theme lives in `src/lib/velaTheme.ts`. Change both together or the chart will drift
from the UI. Use semantic classes (`bg-background`, `text-muted-foreground`,
`border-border`, `bg-primary`) instead of raw hex values in components.

**Binance streams may fall back to polling.** The bundled provider can log
`stream delivered no data; falling back to polling` in restricted environments.
That is expected; do not treat it as a chart bug.

**Synced drawings rebuild their links.** Vela 0.10.7 relinks identical drawing
copies on boot, `applyState` and when drawings sync is enabled; the app stores no
pairing field. A copy edited while sync was off stays independent.

**No speculative platform work.** There is no auth, backend, trading, Electron, or
Nautilus integration. Do not add them, or scaffold for them, without an explicit
request. Keep public market data and the Vela host separated so a future sidecar can
replace the data boundary cleanly.

**Licensing.** Vela is Apache-2.0 and its attribution watermark stays enabled.
The local Pine engine is MIT. LuxAlgo Library scripts keep their own licence
(usually CC BY-NC-SA 4.0) and are saved with the header intact; private use is
fine, redistribution is not without meeting those terms.

**No secrets.** The app uses public endpoints only. Never add API keys to the client
or commit `.env`; `.env*` is gitignored.

---

## Testing and verification

Reach for the cheapest tool that proves the thing:

- **Unit tests** for pure logic: symbol/timeframe mapping, formatting, plot
  extraction, view validation. Put them in `test/` and run `npm test`.
- **The browser** for Vela rendering, layout changes, table interaction, theme,
  persistence, and the scanner. Start `npm run dev` and drive the real page.
- **Production preview** for worker or build changes: `npm run build` then
  `npm run preview -- --port 4173`.
- **Electron** for desktop changes: `npm run electron:pack`, then run
  `release/win-unpacked/Screener.exe --smoke`. The smoke run writes a JSON result
  (`%TEMP%\screener-v2-smoke.json` by default) with the rendered table row count
  and exits non-zero when the table stays empty.

Two rules that earn their keep:

- **Positive proofs, not green gates.** A new feature needs a check that would fail
  if the feature were absent: a targeted unit test, or a browser probe that exercises
  it end to end.
- **Probe computed reality, not presence.** Assert visible row counts, canvas counts,
  dynamic table columns, a rendered study pane, the active cell outline, and the
  resolved background color. An element that exists but is hidden or transparent
  passes a lazy probe and fails the user.

Useful browser probes:

- The first column holds only the favorite star, the second only the exchange
  icons with the globe/sort header, the third is `Symbol` with its coin badge and
  search field; the chart canvas has a non-zero bounding box. Scrolling the table
  right keeps those three columns pinned.
- Unchecking a venue removes its rows immediately and survives reload; `All
  venues` can clear the list and the table explains the empty selection.
- Clicking a venue column header cycles descending → ascending → unsorted; the
  third state restores the merged 24h-volume order.
- Clicking an OKX/Coinbase row opens that venue's chart and survives reload;
  Binance perp tabs keep `BINANCE:...P` through the same round trip.
- The Vela symbol picker shows the venue icon before each badge and keeps the
  provider name as text.
- Switching the layout select to `2h`/`4` changes the live cell count and the tab
  badge; the second cell is the alt symbol, not a duplicate.
- In a multi-cell grid the leftmost topbar control (left of `Layouts`) expands
  the active cell over the widget (`data-maximized=1`, siblings hidden), flips to
  Restore, and returns the grid on a second click; a single-cell grid hides it.
- Zoom a cell to its scale floor, maximize it: the host loads enough history to
  fill the wider window at the same `barSpacing` (no click, resize or refit), and
  the left edge shows candles instead of empty space.
- The right sidebar's top camera downloads the tab's layout PNG; the topbar has
  no screenshot button. The panel buttons open `Screener`, `Pine`, `Library`,
  and `Alerts` as one Vela side panel at a time; the topbar keeps Maximize and
  Layouts. The open panel and width survive reload. The legend source action
  opens the Pine panel.
- A script with `alert()` on the active chart fills the `Alerts` rail panel with
  the symbol, timeframe, message and indicator; the topbar has no bell, and the
  rail button carries the alert count. Clearing empties the list and the count,
  and a reload starts empty.
- A strategy script shows its fill arrows and labels on the price pane and opens
  the strategy strip at the foot of the chart column, under the range presets,
  with net P&L, the five metrics and the equity curve. The drawing toolbar and
  the right rail stay full height; only the chart column shrinks. Dragging the
  handle and collapsing to the header resize it live, and both survive a reload.
  `Open strategy viewer` shows
  `Performance` (five metrics, large curve) and `Trades Log` (entry/exit, size,
  net and cumulative P&L); scripts that reuse one `strategy.exit` call still list
  every round trip separately. Editing the script under the same indicator id
  replaces the ledger instead of mixing two backtests; deleting the indicator
  hides the dock.
- Creating a workspace with `+` immediately requests its klines and renders candles;
  expanding `1 → 2×1` fills the second cell with `altSymbol`, not a duplicate.
- Clicking a table row changes the active cell symbol and the tab label; the
  selected row is matched by its venue-qualified symbol.
- Starring a row keeps it in the active list after reload; the star click does not
  change the active workspace symbol. The default list starts empty, can be
  renamed or cleared, cannot be deleted, and legacy bare favorites migrate to
  `binance:perp:...`. Creating `Majors`, switching to it, and starring an OKX row
  keeps the lists separate; the favorites button follows the active list, the
  panel title stays `Screener`, import lands in the active list, and export
  writes every list. A favorite below the watch threshold stays out of the
  table, because the sidecar never fetched it.
- At the default 1M threshold the table lists every watched instrument from all
  checked venues (1,000+ rows) and grows no `TopN` cap; raising the threshold in
  Settings drops rows on the next poll. Range 24h, VolΔ24h, RVOL 7d, VWAPσ and
  RSI 15m show values within a few minutes of the first load, and the sidecar
  log has no venue 429. `RSI <30` narrows the table to the oversold rows and
  clicking it again restores them; `RSI <30` + `RVOL ≥1.5` keeps only the rows
  that pass both. The `All` / `Favorites` switch before the list combines with
  them: starring two rows and leaving `RSI <30` shows only starred oversold rows,
  and clearing the search and the chips still shows the whole starred list.
  Changing the metrics timeframe relabels the RSI header and
  recomputes every row without a page reload.
- Applying the RSI preset and scanning two venues adds RSI / Oversold /
  Overbought columns to both venues' rows; one venue's failure leaves the other
  values intact.
- Saving a script adds it to the Library and to the custom `Indicators` window
  under `My scripts`; adding it there changes the on-chart count, and both the
  library and the applied entry survive a reload. The native `Indicators` button
  opens this window, not Vela's picker; `/` opens it too.
- The `Indicators` window is a three-pane picker: `Yours` / `Built-in` /
  `Library` on the left, results in the middle, details on the right. Searching
  `rsi` lists `My scripts` and built-ins before Library cards; `Discover` shows
  new releases and families, and `All scripts` counts the bundled catalog. A
  native row shows `On chart` after add even when its legend title differs
  (Connors RSI → CRSI); remove it from the legend, reload, and it stays gone.
- Adding the same saved script twice appends two handles
  (`saved-<id>:<instance>`) and two legend rows. `On chart` stays visible but
  Add remains enabled; both copies survive reload and reload restores their
  names.
- `Favorites` and `Recent` persist at `screener.indicators.picker.v1`; `F`
  toggles the selected favorite, `Enter` adds and closes, `Ctrl/⌘+Enter` adds
  and keeps the window open, `Esc` closes. `Bring a script` imports a `.pine`
  and the script appears under `My scripts`.
- The Pine panel's top row holds `Apply` and `All`. Applying a script that is
  already on the chart updates the same legend row and keeps its inputs and
  props; a new plot in the edited source appears, and a broken source reports
  the error while the previous code keeps running. `All` adds or updates every
  cell. Deleting the applied row from the legend clears the tab's stored script:
  `Update layout` then drops `pine` from the snapshot, a reload does not reapply
  it, and switching layouts does not bring it back. The AI calls
  `edit_code` then `apply_live` and reports
  the live result.
- Change a setting of the applied Pine script (for example `Show MA lines`),
  reload: the value survives and the script reopens with it. The tab stores the
  applied inputs in `pineInputs` and property overrides in `pineProps`; a layout
  saved after the change restores the same script settings. The MIT engine does
  not declare props yet, so its settings dialog currently shows inputs only.
- Zoom in, reload: the same number of bars comes back with the right edge on the
  latest bar and the same whitespace after it (Settings → Margins → Right = 10
  gives 10 bars). Pan only, reload: the chart opens at the latest bar, not at the
  panned window. Older `screener.viewport` keys stay inert; the zoom lives under
  `screener.scale`.
- With two cells on the same symbol, activate the second cell and reload: the
  document's `activeCellId` stays active instead of the host switching to the
  first matching symbol.
- The `Layouts` toolbar action sits right after Maximize and shows the active
  tab's linked layout name (or `Layouts`). Saving a 2×2 workspace creates an item in
  `screener.layouts.v1` and renames the action. A row click loads the layout into
  the current tab (grid, markets, indicators, drawings, script); `Open in new
  tab` seeds a new tab with the same state and survives a reload with its own
  edits; `Update` asks before overwriting the saved snapshot, then captures
  the live state; `Duplicate…` copies the active layout through the name
  dialog, and the row menu duplicates, renames and deletes too;
  `Export all` writes `screener-layouts.json` and `Import` merges it with a
  unique name. A full localStorage reports the quota error instead of losing the
  save.
- The `LuxAlgo` tab lists the bundled catalog, search filters it, and `Add`
  loads the full source: the on-chart count grows, the row shows `On chart`, and
  the script appears in `My scripts` with its Library URL in notes. Add can be
  used again to append another copy. A large
  script (SMC, ~50 KB) adds the same way. After reload the saved source remains
  in the library.
- Three workspace tabs stay live: add a saved or Library script to each, switch
  between them, and every chart keeps its indicators and panel state. Reload the
  active tab restores its external scripts from the workspace document; other
  tabs restore on first visit. The chart source action opens Pine and selects the
  saved item in the Library panel.
- A script with `request.security("ETHUSDT", "D", ...)` plots the previous
  completed ETH daily bar, and the same-TF `[high[3], low[3]]` form reads the
  foreign hourly bars; the CRT Engine SMT labels (`smt ETHUSDT`) appear on a
  BTC chart with the default auto pair. A symbol the venue cannot serve returns
  `na` and reports one warning instead of drawing a flat line.
- The Pine editor renders a non-empty `.monaco-editor` with line numbers,
  highlighted tokens, lint squiggles, and the resolved editor background from
  the active theme; right-click offers Go to Definition, Change All Occurrences,
  Discard all changes, Cut/Copy/Paste, Find/Replace, New tab, Open script, Save
  script, Toggle console and Command Palette. Go to Definition resolves user
  symbols; Discard restores the saved Library source after confirmation; New tab
  adds a Pine editor tab, not a chart tab; Open script opens the Library panel;
  Toggle console toggles the AI sidebar. `Ctrl/Cmd+S` saves, `Ctrl/Cmd+Enter` runs
  the scan, `Ctrl/Cmd+F12` goes to a definition, `Shift+Alt+F` formats,
  `Ctrl+Shift+O` lists the outline, signature help appears on `(` and user
  parameters get semantic colors; hover on a built-in function shows its v6
  description, parameters and returns, and hover on an object type or namespace
  shows the type or member docs. Switching between Pine tabs preserves each
  buffer, cursor and undo stack; the tab strip and active tab survive a reload,
  and closing a dirty tab confirms first. `New tab` starts from `NEW_SCRIPT` and
  never inherits the previous tab; `Ctrl+Z` there does not bring the other
  script back. Type in one tab, switch away and back, then `Ctrl+Z`: only that
  tab's edit is undone. A saved CRLF script opens without a dirty dot, and
  closing the active tab moves the editor to a remaining tab.
- Applying a script that uses `request.security_lower_tf` loads the
  `engine.worker-*.js` chunk, plots the lower-timeframe count, and leaves the
  main thread responsive; the console has no worker errors.
- Every Pine legend row has an `Ask AI about this script` sparkles action before
  `Source code`; native rows have none. Clicking it opens the AI sidebar with
  `Editing <name>`, creates or reuses the script's Pine tab, and leaves that
  target in place when the user switches tabs.
- The AI toggle sits at the top of the left drawing toolbar above `Cursor`;
  clicking it opens the sidebar (the chart host refills history), flips to
  `Hide AI` with the active highlight, and closing restores the chart. The width
  survives reload; collapsing the drawing toolbar hides the rail with the tools.
  With the mock model, `get_script` / `apply_script` / `run_script` /
  `get_chart_context` run end to end: the editor buffer becomes the returned
  source, `run_script` returns `{ ok, live, worker }` with plots, warnings and
  worker log lines (the live run adds vars and engine errors), a broken script
  returns its error, and a `Chart`-attached turn sends the PNG as a user image
  part (`image_url` reaches the provider). A script using
  `request.security_lower_tf(syminfo.tickerid, "1", [close])` on a 5m chart
  reports the same intrabar count in `live` and `worker`, and the worker logs no
  `needs 1-minute intrabar data` warning.
- The assistant-ui chat shows `Chat` / `All chats` tabs. History searches titles
  and chart context, groups by date, renames inline and deletes; empty chats are
  hidden. After the first reply the title is generated in the user's language
  (fallback: the first prompt); a manual rename is never overwritten. Reload
  keeps the active chat, and the old `screener.ai.aui.v1` transcript folds into
  one chat.
- Chats persist: send in one, create another, switch back, reload, and both
  titles and transcripts survive; deleting the active chat falls back to the
  next one. Attaching a PNG and a `.pine` file shows two chips, the request
  carries both images and the file text, and reload keeps the text but not the
  base64. With a fake media device, dictation fills the composer from the
  sidecar transcription; the mic is hidden without a transcription model.
- A script over 40k chars comes back from `get_script` as
  `{ chars, lines, truncated: true, source: null, outline }`; `read_lines(1, 5)`
  returns exactly those raw lines and the total; `edit_code` with one anchor
  changes only that line (the stored script grows by the newStr delta) and the
  rest of the file keeps its length. `apply_script` with a 100k source returns
  `applied: false` instead of overwriting the buffer.
- The topbar hamburger opens `File / View / Window / Help`; File and View actions
  drive the existing React state, Window uses the preload bridge, and About opens
  the app modal.
- The Electron title bar has `titlebar.bridge=true`, a non-zero
  `paddingRight`, and `appRegion=drag` in the smoke result; the native window
  controls do not overlap the header buttons. Resize the window, quit and
  relaunch: the size and position come back; a monitor that is no longer
  connected falls back to the default 1440×900, an oversized saved window clamps
  to the display work area, a negative `y` keeps the title bar on screen, and a
  1366×768 primary caps the default size.
- Toggling the theme updates both the app tokens and the native title-bar
  overlay colors.
- Reloading restores tabs, layout, active cell, theme, open side panel, and the applied Pine
  script with its settings.

When Binance is unavailable, report the environmental failure and verify against
the offline/test seams instead of inventing mock data in the app.

---

## Verify for real

If you tell the user something is **fixed**, **verified**, or **works**, you must
have executed the check that proves it through the same surface the user uses.

- Say what you ran and what you did not run.
- Re-run the user's exact scenario before reporting a bug fixed.
- If you cannot run the check, mark it **unverified**.

---

## Reproducing reported issues

1. Reproduce first. Do not fix what you cannot reproduce.
2. If it reproduces in a unit test, write the failing test before the fix. The fix is
   done when that test and the gate pass.
3. If it only reproduces in the browser, reproduce it there, fix it, and re-run the
   exact interaction there.

---

## Code ground rules

- **TypeScript is strict.** Avoid `any`; when an external response is untrusted,
  normalize it at the boundary in `lib/binance.ts` and keep typed app shapes in
  `types.ts`.
- **Use the existing UI kit.** `ui/primitives.tsx` has buttons, inputs, selects,
  segmented controls, badges, progress, and spinners; `ui/overlays.tsx` has the
  dialog and popover. Do not add a second button style or a one-off modal.
- **Keep data access in one place.** Components do not call Binance directly.
  `lib/binance.ts` owns endpoints, mapping, caching, and candle normalization.
- **Keep Vela imperative code in the host.** Table and Pine components call the
  `VelaWorkspaceHandle`; they do not reach into `VelaWorkspace` internals.
- **Prefer public Vela seams.** Use `addExternalIndicator`, events, and workspace
  state. Do not fork or patch Vela inside this repo.
- **Persist JSON-safe state and validate it on read.** `usePersistedState` takes a
  validator. If a persisted shape changes, update the validator and use a new key or
  a migration; never assume old localStorage.
- **No new dependency without a concrete need.** Base UI, Lucide, Sonner, and
  Tailwind already cover the UI. Do not add a charting library, state library, query
  library, or component kit speculatively.
- **English only** in code, comments, docs, and commit messages, regardless of the
  conversation language.
- **Comments state constraints the code cannot show.** No narration of the next
  line, no review commentary. Match the surrounding naming and density.
- **Do not name competing chart products** in code, comments, or commit messages.
  Integration names such as Binance or Vela are fine where they identify the real
  dependency.
- **Do not weaken safety.** Public endpoints only; no keys, no trading commands, no
  auth bypasses.

---

## Documentation

`README.md` is the user-facing guide: stack, commands, features, licensing. Update it
when a user-visible feature or command changes.

This file is the agent guide. Update it when architecture, invariants, the gate, or
the intended scope changes. There is no `docs/` tree or `CHANGELOG.md` yet; do not
invent one unless the user asks.

### Vela documentation

The public Vela docs are at <https://docs.luxalgo.com/vela>. Read them before
reaching into `node_modules` or the peer `../Vela` checkout:

- Workspace and layouts: <https://docs.luxalgo.com/vela/user/workspace>
- API reference (chart, events, controls): <https://docs.luxalgo.com/vela/user/api-reference>
- Data providers: <https://docs.luxalgo.com/vela/user/data-providers>
- Plugin SDK and widget actions: <https://docs.luxalgo.com/vela/contributing/plugin-sdk>
- Architecture and data flow: <https://docs.luxalgo.com/vela/architecture/overview>

The docs page exposes "View as Markdown"; the LLM index is
<https://docs.luxalgo.com/llms.mdx/vela/content.md>. Vite and `tsconfig` resolve
`@luxalgo/vela` to the local `../Vela/src` checkout; `package.json` keeps the npm
pin as a fallback and must name the same minor: `^0.10.8`.

The checkout must be Vela 0.10.8 or newer. Since 0.10.7 `cell.timeframe` and
`cell.priceStyle` are the values the chart shows (a provider or style fallback),
while `cell.requestedTimeframe` and `cell.requestedPriceStyle` are the user's
choices: persist and capture the requested values, display the shown ones.
Since 0.10.1 Vela imports
`@luxalgo/vela-ui` in its chrome, and the app resolves that kit from
`../Vela/packages/vela-ui/src` — the `vela-ui-source` plugin in `vite.config.ts`
maps the package and each subpath (`components/*.ts`, `lib/*.ts`), with matching
`tsconfig` paths. The local `dist` is not built and is not needed. Older
checkouts (0.9.3) lack `packages/vela-ui` and break the build; run
`npm run typecheck` after any Vela branch change. Do not patch or fork Vela from
this repo.

### Pine engine

The scanner runs `@screener/pine-engine`, a local MIT checkout at
`../pine-engine` resolved through `vite.config.ts` and `tsconfig.json` paths the
same way Vela is. It owns the Pine lexer, parser, code generator and bar-by-bar
runtime; no third-party transpiler runs at runtime. MIT `oakscriptjs` is a
devDependency used only by the differential RSI test, so no AGPL code is
involved. Edit the engine there and the app picks it up without a rebuild. The
engine owns the compile-once/run-many API the scan worker needs; the app keeps
only the venue fetching and the table mapping.

`@screener/pine-editor` (`../pine-editor`) owns the Pine language data and the
Monaco editor. The base entry (`@screener/pine-editor`) is editor-agnostic: a
line tokenizer, completions from the MIT `pinescript-v6-validator` signature
table, and the local v6 rules plus that validator's findings. The tokenizer
handles triple-quoted strings, `//@` annotations and the v6 keyword and type
sets. `@screener/pine-editor/monaco` maps that data onto Monaco: a tokens
provider, language configuration, completion provider, model markers and the
`--pine-*` theme, plus the worker setup. `markers.ts` clamps findings to the
document and `colors.ts` expands Chromium's three-digit computed colors because
Monaco token colors need six or eight digits. `syncContextViewTheme` copies the
menu's `--vscode-*` variables from the editor root onto its container: Monaco
renders the context menu in a shadow root that is a sibling of
`.monaco-editor`, so without the copy the menu is transparent. `pineFeatures.ts`
maps the editor-agnostic core of the local MIT
`../pine-script-syntax-highlighter` checkout (aliased as
`@pine-highlighter/*`) onto Monaco: document formatting, signature help,
semantic tokens for user symbols, definition lookup and the document outline.
Hover uses the reference data from the same checkout, loaded in its own 1.25 MB
chunk on the first hover: hovering a function shows its v6 description,
parameters and returns, a bare object name such as `array` or `label` shows the
type docs, and a namespace such as `syminfo` lists its members. Only its `core/`
directory is imported; its VS Code providers are not. The validator and its 475
signatures load through a dynamic import on first use, so neither is in the
initial bundle. `@screener/pine-editor/monaco/react` exports the `PineEditor`
component; `PinePanel` lazy-loads it and passes the app theme. The component
keeps one Monaco model per Pine tab (`tabId`) and switches with `setModel`
plus the saved view state, so undo/redo, cursor and scroll never cross tabs;
models of closed tabs are disposed. Pine sources are normalized to LF for dirty
checks, tab lookup and saved-script plans, so a saved CRLF script does not open
as a dirty draft. The package keeps `monaco-editor` and optional React peers, so
the language entry stays usable without a DOM editor.

`lib/pineVela/engine.ts` is the chart engine: `PineEngine` implements Vela's
`ScriptingEngine` port over `pine-engine`, registered as
`engines: { pine: () => new PineEngine() }`. It reports `streaming: false`, so
Vela re-runs it on every bar notification; the adapter coalesces those runs with
a cooldown scaled to the previous run (250 ms—2 s) and drops live ticks during a
pan/zoom gesture, so a 5000-bar script cannot hitch the drag. Forced runs
(inputs, history completion, first paint) bypass the cooldown. The run itself
happens in a module worker (`engine.worker.ts`) through `workerClient.ts`; one
worker belongs to one `PineEngine`, sessions are multiplexed by id, and an idle
worker is terminated after 30 s. Pending worker replies are keyed by
`sessionId:runId`; each indicator runner starts its own run counter at 1, so two
indicators in one cell must not share a reply slot. `PineEngine` keeps the Vela mapping, alert
deduplication, snapshot and cooldown on the main thread. `prepare()` compiles
once on the main thread for the input/meta schema; the worker compiles its own
copy on the first run. The worker owns `session.ts` state: bars, inputs, visible
range, lower/foreign caches and nested probe results. `request.security` returns
`needs`; the main thread fetches the series and posts `resume`. The prepared token
carries `source`, `instanceId`, `shortName` and `overlay`; `modelOf` takes
`overlay`/`paneHint` from that prepared value, not from the computed run, so an
overlay script never drifts into a separate pane. Hosts without a global
`Worker` (Node/Vitest) use the same session through `LocalPineRunner` on the
main thread. It reports
`visibleRange: true` (scripts using
`chart.*_visible_bar_time` re-run through `setVisibleRange`), and `inputs: true`,
so the settings dialog works. It emits plots plus `line`/`box`/`label` drawings and `bgcolor`
spans (`lib/pineVela/drawings.ts`). The engine returns the final drawing
objects after the run: `set_*` calls are already applied, deleted objects are
dropped, `bgcolor` entries are merged into spans, and tables are passed to the host. `plotshape`/`plotchar`/`plotarrow` points are returned as shape markers and drawn as label shapes. `hline()` becomes a `PriceLine`, `fill()` a band between two plot series (an hline anchor becomes a hidden constant series so it stays out of the scale), and `barcolor()` recolors the chart candles through `barColors`. `plotcandle`/`plotbar` keep per-bar colors on the candle series. Unknown builtins resolve
to `na` and are reported through `missingStd`. `alert()` and `alertcondition()`
raise one alert per bar per call site, and `strategy.*` orders run the backtest
in `lib/pineVela/strategy.ts`. `request.security` works for the chart's own symbol on its own timeframe and, on a higher timeframe, by resampling the chart's bars: builtin source expressions take the fast spec path, while arrays, UDT tuples and other expressions run a nested HTF probe (the script executes once on the resampled bars, snapshots the expression per HTF bar, and the chart bar reads the snapshot the gaps/lookahead contract selects; one probe per call site and timeframe (the target site captures even when the
script recomputes its timeframe argument inside the probe, as an auto timeframe
derived from `timeframe.in_seconds()` does), and a probe the script's own guards
reject falls back to `na`; the worker session caches probe results and invalidates them when the inputs, the cached lower series, or the foreign series change). Lower timeframes read intrabar bars the host fetches through Vela's `fetchSeries` (60 s cache; the adapter strips the chart's venue prefix so `syminfo.tickerid` resolves; the sidecar's venue adapter pages past its 1500-bar cap inside the shared limiter; the local pass paints first, and a 20 s fetch timeout prevents a stuck chart): simple sources read the last lower bar per chart bar, while an array/UDT expression probes the host's lower series and reads its last bar inside the chart bar; `request.security_lower_tf` returns the lower bars inside each chart bar and `source[n]` offsets count lower bars. `ta.atr(...)` inside a security tuple is evaluated over those lower bars. A **foreign symbol** is fetched through the host at the requested timeframe: the adapter keys the bars `<symbol>@<tf>` and the engine selects the bar by the lookahead/gaps contract, reading source specs directly from the foreign series and running the tuple/function probe over its bars; a bare `ETHUSDT` resolves to the chart venue's perpetual (OKX/Bybit style tickers included). A foreign symbol the chart's venue cannot serve and an unbounded expression inside a security tuple return `na` with a warning.
`na` is `NaN`, so warm-up arithmetic and comparisons behave like Pine, and
`if not na(box)` guards still work because a drawing handle is an object. Each
TA call site keeps its own state and source series, so two EMAs and chained
`ta.ema(fast, 9)` do not interfere, and a scan run does not inherit the previous
instrument's state. `var` initializes on the first bar from that bar's data. It
waits for `historyState: 'complete'` instead of running on a partial backfill.
Series ids come from `stableSeriesId` so value patches hit the same series
across runs.

---

## Commit discipline

- Present the change and wait for explicit approval before committing.
- Use targeted `git add`; never commit `node_modules/`, `dist/`, `.scratchpad/`, or
  unrelated local files.
- Keep commit messages user-readable, in English, and free of other products' names.
