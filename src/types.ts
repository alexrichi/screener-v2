import type { Instrument, MarketKind, VenueId } from './venues/types';

export type ThemeMode = 'dark' | 'light';

export type QuickFilter =
  | 'gainers'
  | 'losers'
  | 'rsiLow'
  | 'rsiHigh'
  | 'rvol'
  | 'aboveVwap'
  | 'belowVwap';

export type MarketFilter =
  | 'all'
  /** Legacy stored value; the table now reads it as `favoritesOnly`. */
  | 'favorites'
  | QuickFilter;

export interface MarketRow {
  /** Full instrument identity: key, venue, native id, display and Vela symbol. */
  instrument: Instrument;
  price: number | null;
  change24h: number | null;
  quoteVolume: number | null;
  funding: number | null;
  nextFunding: number | null;
}

export interface ScreenerMetrics {
  sessionRangePct: number | null;
  volumeChange24hPct: number | null;
  rvol: number | null;
  vwapZ: number | null;
  rsi: number | null;
}

/** One row of the server-side screener. The table only sees watched rows. */
export interface ScreenerRow extends MarketRow {
  metrics: ScreenerMetrics;
  updatedAt: number;
  warming: boolean;
  missing: string[];
  staleMetrics: string[];
}

export interface ScreenerStatus {
  ready: boolean;
  watched: number;
  warming: number;
  lastUpdate: number | null;
  venues: Array<{
    venue: VenueId;
    state: 'ok' | 'degraded' | 'error';
    watched: number;
    lastUpdate: number | null;
    message?: string;
  }>;
}

export interface ScreenerSnapshot {
  rows: ScreenerRow[];
  status: ScreenerStatus;
}

export interface ScreenerPatch {
  rows: ScreenerRow[];
  removed: string[];
  status: ScreenerStatus;
}

export interface ScreenerConfig {
  timeframe: string;
  rvolDays: number;
  rsiPeriod: number;
  /** Per-venue watch thresholds; an omitted venue uses its own default. */
  minVolumeByVenue?: Partial<Record<VenueId, number>>;
  /** Checked venues; omitted means every venue the sidecar serves. */
  venues?: VenueId[];
}

export type AlertInputValues = Record<string, string | number | boolean>;

/** One instrument a chart-created alert watches. */
export interface AlertInstrumentTarget {
  kind: 'instrument';
  venue: VenueId;
  /** Vela symbol (`BINANCE:BTCUSDT.P`), used to resolve the adapter's instrument. */
  velaSymbol: string;
  /** Display ticker (`BTCUSDT.P`). */
  symbol: string;
}

export type AlertFrequency = 'once' | 'once-per-bar-close';

/** How a price alert reacts to the level. */
export type AlertPriceCondition = 'crossing' | 'crossing-up' | 'crossing-down';
export type PriceAlertFrequency = 'once' | 'every-time';

export interface AlertNotificationPrefs {
  toast: boolean;
  sound: boolean;
  system: boolean;
}

interface AlertRuleBase {
  version: 1;
  id: string;
  name: string;
  target: AlertInstrumentTarget;
  timeframe: string;
  notify: AlertNotificationPrefs;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastFiredAt: number | null;
  fireCount: number;
}

/**
 * A binary alert created from a chart's Pine indicator. It stores a snapshot of
 * the script and inputs and is evaluated by the sidecar on closed bars, so the
 * chart and its workspace tab can close without stopping it.
 */
export interface ChartAlertRule extends AlertRuleBase {
  kind: 'chart';
  script: string;
  inputs: AlertInputValues;
  /** `alertcondition` titles to watch. */
  sites: string[];
  /** Also fire for plain `alert()` calls. */
  includeAlert: boolean;
  frequency: AlertFrequency;
  indicatorTitle: string;
}

/**
 * A level alert. The runner watches the live forming bar of the target and
 * fires when the price crosses the level; `every-time` re-arms after the price
 * returns to the other side.
 */
export interface PriceAlertRule extends AlertRuleBase {
  kind: 'price';
  price: number;
  /** Price as shown when the alert was created, e.g. `61 733.2`. */
  priceText: string;
  condition: AlertPriceCondition;
  frequency: PriceAlertFrequency;
  message?: string;
}

export type AlertRule = ChartAlertRule | PriceAlertRule;

/** One fired alert, shown in the global history. */
export interface AlertEvent {
  id: string;
  kind: 'chart' | 'rule';
  ruleId?: string;
  tabId?: string;
  cellId?: string;
  venue?: VenueId;
  velaSymbol?: string;
  symbol: string;
  timeframe?: string;
  source: string;
  site?: string;
  message: string;
  price?: number;
  time: number;
  receivedAt: number;
}

/** A rule as the sidecar evaluates it: targets are already resolved. */
export type AlertRunnerRule = AlertRule & { targets: string[] };

/** One row of the active chart's indicator picker. */
export interface IndicatorRow {
  /** Index in `ChartCell.libraryRows()`; `-1` for an app-saved script. */
  index: number;
  /** Saved-library id for app scripts; null for a Vela built-in. */
  savedId: string | null;
  name: string;
  native: boolean;
  category: string | null;
  language: string | null;
  nativeType: string | null;
  beta: boolean;
  present: boolean;
}

export interface WorkspaceTab {
  id: string;
  /** Vela symbol, bare Binance ticker, or provider-qualified symbol. */
  symbol: string;
  timeframe: string;
  /** Vela layout id: '1' | '2h' | '2v' | '4' | '8' | custom. */
  layout: string;
  /** Second chart used when the layout grows past one cell. */
  altSymbol: string;
  /** Last Pine script applied to this workspace (restored on remount). */
  pineScript?: string;
  /** Display name of that script. */
  pineName?: string;
  /** Whether that script was applied to every cell. */
  pineAll?: boolean;
  /** Input overrides of the applied script, restored with it on remount. */
  pineInputs?: PineInputValues;
  /** Property overrides of the applied script, restored with it on remount. */
  pineProps?: PineInputValues;
  /** Saved layout this tab was opened from or last linked to. */
  layoutId?: string;
  /** Favorites list this tab's screener shows; the global pick is the fallback. */
  favoriteListId?: string;
}

/** JSON-safe input overrides for a script's settings dialog. */
export type PineInputValues = Record<string, string | number | boolean>;

/** The active cell's chart, as reported to the AI sidebar. */
export interface ChartContext {
  symbol: string;
  timeframe: string;
  layout: string;
  indicators: string[];
  /** The applied Pine-panel script, distinct from the editor buffer. */
  appliedPine: { name: string; chars: number } | null;
  cells: number;
  /** Bars loaded in the active cell, including the forming bar. */
  bars: number;
  /** Visible window in epoch milliseconds, when the chart has painted. */
  visible: { from: number; to: number } | null;
  /** Native drawings on the active chart, newest last. */
  drawings?: Array<{ id: string; type: string; text: string | null }>;
}

/** One debug evaluation of a Pine script, on the live chart or in the debug worker. */
export interface ScriptRunSummary {
  ok: boolean;
  error: string | null;
  /** JavaScript stack from the engine; the only mapping we get for transpiled Pine. */
  stack: string | null;
  errorName: string | null;
  /** `PineRuntimeError.method`, e.g. `array.get`, when the engine reports one. */
  method: string | null;
  complete: boolean;
  warnings: string[];
  /** Last finite plot values, keyed by plot id. */
  plots: Record<string, number | null>;
  /** Scalar vars, stringified; large objects are dropped. */
  vars: Record<string, string>;
  strategy: boolean;
  /** Bars the run evaluated. */
  bars: number;
  /** `max_bars_back` declared by the script, when present. */
  maxBarsBack: number | null;
  /** Venue-qualified symbol and timeframe the run used. */
  symbol: string;
  timeframe: string;
  /** `log.info` / `log.warning` / `log.error` lines, oldest first. Worker only. */
  logs: string[];
  /** Zero-based bar whose worker variables were snapshotted. */
  debugBar?: number;
}

/**
 * `run_script` runs the source twice: on the live chart and in a disposable
 * worker over sidecar bars. The chart is the truth; the worker runs the same
 * engine in isolation and adds a second result to compare against.
 */
export interface ScriptRunReport {
  ok: boolean;
  live: ScriptRunSummary;
  worker: ScriptRunSummary;
}

export interface SortState {
  key: string;
  dir: 1 | -1;
}export interface ColumnState {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

export interface ScreenerView {
  /** Null means the table keeps its incoming (merged volume) order. */
  sort: SortState | null;
  columns: ColumnState;
  query: string;
  /** Legacy single filter; read only when `filters` is absent. */
  filter?: MarketFilter;
  /** Independent quick filters, combined with AND. */
  filters?: QuickFilter[];
  /** Show only the rows in the active favorite list; combines with `filters`. */
  favoritesOnly?: boolean;
}

export interface PlotValue {
  key: string;
  title: string;
  value: number | null;
}

export interface ScanResult {
  /** Instrument identity: venue:kind:nativeId. */
  key: string;
  venue: VenueId;
  /** Native venue ticker, used for display. */
  symbol: string;
  plots: PlotValue[];
  error?: string;
  ms: number;
}

export interface PlotColumn {
  /** Stable table key, prefixed with `plot:`. */
  key: string;
  /** Pine plot key. */
  plotKey: string;
  title: string;
}

export interface ScanProgress {
  done: number;
  total: number;
  venue?: VenueId;
  symbol?: string;
}

/** One sequential scanner pass: a venue and the instruments to run. */
export interface ScanTarget {
  venue: VenueId;
  instruments: Instrument[];
}

export interface Settings {
  /** Per-venue watch thresholds; a missing venue uses its own default. */
  minVolumeByVenue?: Partial<Record<VenueId, number>>;
  /** Kept for old stored settings; the screener table no longer trims by it. */
  topN: number;
  scanTimeframe: string;
  scanBars: number;
  /** Kept for old stored settings; the sidecar owns the ticker poll now. */
  refreshSeconds: number;
  defaultLayout: string;
  /** Server-side screener technical timeframe; defaults to 15m. */
  metricsTimeframe?: string;
  rvolDays?: number;
  rsiPeriod?: number;
}

export interface ScanRequest {
  id: number;
  script: string;
  timeframe: string;
  targets: ScanTarget[];
  bars: number;
  concurrency: number;
}

export type ScanWorkerIn =
  | ({ type: 'scan' } & ScanRequest)
  | { type: 'abort'; id: number };

export type ScanWorkerOut =
  | {
      type: 'progress';
      id: number;
      done: number;
      total: number;
      venue: VenueId;
      symbol: string;
    }
  | { type: 'result'; id: number; result: ScanResult }
  | { type: 'done'; id: number }
  | { type: 'fatal'; id: number; error: string };

export type { Instrument, MarketKind, VenueId };
