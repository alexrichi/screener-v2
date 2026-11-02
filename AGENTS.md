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
   `../Vela`, `../Vela-pinets`, and `../PineTS` is fine; do not modify them without
   explicit permission.

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
    VelaWorkspaceHost.tsx         Vela workspace per tab; cells, active-cell sync, Pine apply,
                                  source-code legend action
    ScreenerTable.tsx             market table, filters, favorites, column actions
    PinePanel.tsx                 script editor, saved scripts, apply and scan controls
    PineEditor.tsx                CodeMirror 6 wrapper, Pine mode, keymaps
    LibraryPanel.tsx              saved indicator list, import/export and actions
    SettingsDialog.tsx            universe and scan defaults
  hooks/
    useMarketRows.ts              market-row poll loop via the venue layer
  lib/
    binance.ts                    public futures REST, symbol/timeframe mapping, klines
    format.ts                     price, percent, volume, funding, layout labels
    indicatorLibrary.ts           .pine library model, storage key, validators, import
    favorites.ts                  named favorite lists, migration, import/export
    marketData.ts                 market rows for the checked venues via the sidecar
    universe.ts                   per-venue trim, scan target grouping, favorites key
    velaMaximize.ts               topbar widget actions bridged to ws.maximizeCell
    velaPanels.tsx                Vela side-panel registration and React portal bridge
    usePersistedState.ts          localStorage-backed state with runtime validation
    view.ts                       default screener view and its validator
    velaTheme.ts                  dark/light Vela theme matching the app tokens
  scan/
    extractPlots.ts               last finite plot value from a PineTS context
    scan.worker.ts                PineTS scan worker
    useScanner.ts                 worker lifecycle, progress, cancel, errors
  scripts/presets.ts              built-in Pine presets
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
  hub.ts                          one adapter per venue; shared caches/fan-out
  stream.ts                       Binance kline WS plus a REST-polling stream for
                                  venues without a WS feed
  ws.ts                           generic ref-counted venue WebSocket stream
  venueStreams.ts                 OKX / Bybit / Bitget / Hyperliquid subscription specs
electron/
  main.cjs                        desktop shell: sidecar child, static server, window
  preload.cjs                     narrow title-bar/window IPC bridge
  build-sidecar.mjs               esbuild bundle of sidecar/server.ts for packaging
test/market.test.ts               pure logic tests
test/venues.test.ts               instrument, adapter and rate-limit tests
```

### State and data flow

- `App.tsx` owns tabs, active tab, view, settings, theme, saved
  indicator library, and scan results. Persisted keys are `screener.*`; the
  library lives at `screener.indicators.v1`; workspace state is keyed per tab as
  `screener-v2:ws:<tabId>`.
- The library stores raw `.pine` source only. Saved scripts are passed to the
  Vela host, which maps them to picker-only manifest entries (`enabled: false`,
  `category: 'My scripts'`) and refreshes them with `ws.setIndicators(...)`.
  Apply and scan always use the same source text.
- `useMarketRows` calls `fetchMarketRows` every `settings.refreshSeconds` for
  the checked venues, in parallel through `Promise.allSettled`. Rows come from
  the sidecar only; its `VenueHub` owns one adapter, ticker/bars caches and
  in-flight de-duplication. A failed venue keeps the others visible and surfaces
  as a per-venue warning. `App` applies `minVolume` and `topN` **per venue**
  (`lib/universe.ts`), then merges by 24h quote volume before the table and
  scanner see the rows. OKX has no bulk REST funding endpoint: its adapter keeps
  one `funding-rate` WebSocket subscription for every USDT swap and reads the
  cached rates into `VenueTicker`. A socket failure leaves funding null without
  failing the tickers.
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
  oldest loaded bar (8-bar tolerance) or the zoom hits the loaded-depth limit. A
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
  ignored. Export writes every list as JSON. The table receives the trimmed
  universe plus any active-list favorite outside it, so favorites stay visible in
  the `Favorites` tab regardless of `topN`/`minVolume`; the scanner still uses the
  trimmed universe only.
- A table row click opens `instrument.velaSymbol`, so the active cell follows the
  row's venue. The Vela host projects that change through `setSymbol`.
- The venue filter lives at `screener.marketVenues`; unselected venues are not
  fetched. `Venue` is a fixed first column with icons only and an empty-but-
  sortable header (globe plus the tri-state sort glyph). Column sort cycles
  descending → ascending → unsorted; `ScreenerView.sort` is nullable.
- The Vela host listens to `state:changed`, `cell:active`, and `layout:changed`,
  debounces for 120 ms, and writes the active symbol/timeframe/layout back to the
  tab. Do not update state if the values are unchanged.
- A scan sends `targets: [{ venue, instruments }]` to `scan.worker.ts`. The worker
  walks venues sequentially, compiles one `Indicator`, fetches closed candles
  with bounded concurrency, runs PineTS per instrument, and posts results keyed
  by `instrument.key` plus progress with the current venue. A venue failure or
  rate limit does not stop the remaining venues. The main thread only merges
  results and derives plot columns.
- The applied Pine script is stored on the tab as `pineScript` / `pineAll`. Vela's
  external indicators are not persisted by the workspace document, so the host
  reapplies the stored script on mount.
- Scan results are session-only. Tabs, table view, settings, theme, the open Vela
  side panel, and the applied Pine script persist; scan rows and plot columns do not.
- The table view is global (`screener.view`), not per workspace tab.
  `settings.defaultLayout` applies to new tabs; existing tabs keep their own layout.

---

## Key invariants and gotchas

**Layout is a layout id, not a boolean.** Vela accepts `'1'`, `'2h'`, `'2v'`, `'4'`,
`'8'`, or a registered custom id. `false` removes the layout picker and pins one
chart. Keep the picker enabled: the default is `'1'`. Layout changes come from
Vela's own chart control; the host listens to `layout:changed` and writes the
active layout back to the tab. Do not add a second selector to the app header.

**Cell maximize is transient.** The app registers `screener-maximize` /
`screener-restore` topbar widget actions (`lib/velaMaximize.ts`) in the `actions`
slot, before `Alerts`, bridged to `ws.maximizeCell(active.id)` or `null`. They
are hidden on a single-cell grid and refreshed on `cell:maximized` and
`layout:changed`. Siblings stay alive underneath; the state is never persisted,
and a layout switch or state restore clears it.

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
`cell.addExternalIndicator({ id: 'screener-pine', name, script })`; remove the
previous handle before adding. Store `pineScript`, `pineName`, and `pineAll` on the
tab and reapply on mount. `lastAppliedRef` prevents a double add when the tab state
update and the imperative Apply happen together.

**Saved indicators are picker-only manifest entries.** The library stores raw
`.pine` source only, never transpiled output. The host maps each saved item to
`{ enabled: false, category: 'My scripts', language: 'pine' }` and refreshes the
picker through `ws.setIndicators(...)`. `addSavedIndicator` looks up the index in
`cell.libraryRows()` by category and name, then calls `cell.addFromLibrary(index)`;
keep that lookup aligned with Vela's row order (natives first, manifest after).

**The legend source action uses Vela's public contribution seam.** The host
registers one `registerLegendAction` for Pine indicators and forwards
`LegendIndicatorInfo.source` to `App`, which opens the Pine tab and selects a
saved item only when its source matches exactly. Do not add a parallel chart
button or reach into renderer internals.

**The right-hand panels are Vela side panels.** `lib/velaPanels.tsx`
registers `Screener`, `Pine`, and `Library` with `registerSidePanel` at import
time and portals the React content into the bodies Vela hands `mount`. Open them
with `openVelaPanel(...)`; the dock's open panel and width live in the Vela
workspace document, not in `screener.dock.*`. Do not reach into panel internals.
`screener.panels.welcomed` only controls the one-time Screener default.

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
`background` scans. Hyperliquid uses a single `weight` bucket (`1200/min`):
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

**PineTS output is the contract.** `extractPlots` skips internal `__*` plots and takes
the last finite numeric value. Keep the cap (12) and the table's dynamic column
merge stable. Plot keys are the column identity; titles are display only.

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
theme and window actions, never `ipcRenderer` itself. The smoke result includes
`titlebar.bridge`, `paddingRight`, and `appRegion`.

**Theme changes touch two files.** App tokens live in `src/index.css`; the Vela
theme lives in `src/lib/velaTheme.ts`. Change both together or the chart will drift
from the UI. Use semantic classes (`bg-background`, `text-muted-foreground`,
`border-border`, `bg-primary`) instead of raw hex values in components.

**Binance streams may fall back to polling.** The bundled provider can log
`stream delivered no data; falling back to polling` in restricted environments.
That is expected; do not treat it as a chart bug.

**No speculative platform work.** There is no auth, backend, trading, Electron, or
Nautilus integration. Do not add them, or scaffold for them, without an explicit
request. Keep public market data and the Vela host separated so a future sidecar can
replace the data boundary cleanly.

**Licensing.** Vela is Apache-2.0 and its attribution watermark stays enabled.
Vela-pinets and PineTS are AGPL-3.0. This app is intended for private use;
distributing or hosting it triggers AGPL obligations or requires a commercial
license. Do not remove attribution or relicence dependencies casually.

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

- 100+ rows render across the checked venues; the first column shows only the
  exchange icons, its header shows the globe/sort glyph, and the chart canvas has
  a non-zero bounding box.
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
- In a multi-cell grid the topbar widget action left of `Alerts` expands the
  active cell over the widget (`data-maximized=1`, siblings hidden), flips to
  Restore, and returns the grid on a second click; a single-cell grid hides it.
- Zoom a cell to its scale floor, maximize it: the host loads enough history to
  fill the wider window at the same `barSpacing` (no click, resize or refit), and
  the left edge shows candles instead of empty space.
- The topbar panel buttons open `Screener`, `Pine`, and `Library` as one Vela
  side panel at a time; the open panel and width survive reload. The legend source
  action opens the Pine panel.
- Creating a workspace with `+` immediately requests its klines and renders candles;
  expanding `1 → 2×1` fills the second cell with `altSymbol`, not a duplicate.
- Clicking a table row changes the active cell symbol and the tab label; the
  selected row is matched by its venue-qualified symbol.
- Starring a row keeps it in the active list after reload and after lowering
  `topN` so it falls out of the trimmed universe; the star click does not change
  the active workspace symbol. The default list starts empty, can be renamed or
  cleared, cannot be deleted, and legacy bare favorites migrate to
  `binance:perp:...`. Creating `Majors`, switching to it, and starring an OKX row
  keeps the lists separate; the favorites button follows the active list, the
  panel title stays `Screener`, import lands in the active list, and export
  writes every list.
- Applying the RSI preset and scanning two venues adds RSI / Oversold /
  Overbought columns to both venues' rows; one venue's failure leaves the other
  values intact.
- Saving a script adds it to the Library and to Vela's `Indicators → My scripts`;
  adding it from the picker changes the on-chart count, and both the library and
  the picker entry survive a reload.
- The Pine editor renders a non-empty `.cm-editor` with a gutter, highlighted
  tokens, and the resolved editor background from the active theme.
- The topbar hamburger opens `File / View / Window / Help`; File and View actions
  drive the existing React state, Window uses the preload bridge, and About opens
  the app modal.
- The Electron title bar has `titlebar.bridge=true`, a non-zero
  `paddingRight`, and `appRegion=drag` in the smoke result; the native window
  controls do not overlap the header buttons.
- Toggling the theme updates both the app tokens and the native title-bar
  overlay colors.
- Reloading restores tabs, layout, active cell, theme, open side panel, and the applied Pine
  script.

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
<https://docs.luxalgo.com/llms.mdx/vela/content.md>. The app pins
`@luxalgo/vela@0.9.3`, and the installed package is the source of truth for the
exact API. The local `../Vela` checkout is a reference only; do not patch or fork
Vela from this repo.

### PineTS documentation

PineTS is the TypeScript Pine Script runtime behind the scanner and Vela's Pine
indicators. Its docs are at <https://docs.luxalgo.com/developers/pinets>:

- Getting started: <https://docs.luxalgo.com/developers/pinets/getting-started>
- Initialization and usage: <https://docs.luxalgo.com/developers/pinets/initialization-and-usage>
- `Indicator` and runtime inputs: <https://docs.luxalgo.com/developers/pinets/indicator>
- Syntax guide: <https://docs.luxalgo.com/developers/pinets/syntax-guide>
- Pagination and live streaming: <https://docs.luxalgo.com/developers/pinets/pagination>
- Language coverage: <https://docs.luxalgo.com/developers/pinets/lang-coverage>
- API coverage: <https://docs.luxalgo.com/developers/pinets/api-coverage>
- Using PineTS with Vela charts: <https://docs.luxalgo.com/developers/pinets/using-within-charts>

The LLM index is <https://docs.luxalgo.com/llms.mdx/pinets/content.md>. The app
uses `@luxalgo/vela-pinets` (0.3.2) and `pinets`; the installed packages are the
source of truth for the exact API. PineTS runs scripts over closed bars in
`scan.worker.ts`; do not reimplement Pine semantics in app code. PineTS and
Vela-PineTS are AGPL-3.0: keep the attribution and do not copy their code into
this repo without checking the license.

---

## Commit discipline

- Present the change and wait for explicit approval before committing.
- Use targeted `git add`; never commit `node_modules/`, `dist/`, `.scratchpad/`, or
  unrelated local files.
- Keep commit messages user-readable, in English, and free of other products' names.
