import type { Instrument, MarketKind, VenueId } from './venues/types';

export type ThemeMode = 'dark' | 'light';

export type MarketFilter = 'all' | 'gainers' | 'losers' | 'favorites';

export interface MarketRow {
  /** Full instrument identity: key, venue, native id, display and Vela symbol. */
  instrument: Instrument;
  price: number | null;
  change24h: number | null;
  quoteVolume: number | null;
  funding: number | null;
  nextFunding: number | null;
}

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
}

export interface SortState {
  key: string;
  dir: 1 | -1;
}

export interface ColumnState {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

export interface ScreenerView {
  /** Null means the table keeps its incoming (merged volume) order. */
  sort: SortState | null;
  columns: ColumnState;
  query: string;
  filter: MarketFilter;
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
  /** Native venue ticker, used for display and PineTS. */
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
  minVolume: number;
  topN: number;
  scanTimeframe: string;
  scanBars: number;
  refreshSeconds: number;
  defaultLayout: string;
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
