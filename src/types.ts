export type ThemeMode = 'dark' | 'light';

export type MarketFilter = 'all' | 'gainers' | 'losers' | 'favorites';

export interface MarketRow {
  /** Binance futures symbol, e.g. BTCUSDT. */
  symbol: string;
  base: string;
  quote: string;
  price: number | null;
  change24h: number | null;
  quoteVolume: number | null;
  funding: number | null;
  nextFunding: number | null;
  pricePrecision: number;
}

export interface WorkspaceTab {
  id: string;
  /** Binance futures symbol without the `.P` suffix. */
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
  sort: SortState;
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
  symbol?: string;
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
  symbols: string[];
  bars: number;
  concurrency: number;
}

export type ScanWorkerIn =
  | ({ type: 'scan' } & ScanRequest)
  | { type: 'abort'; id: number };

export type ScanWorkerOut =
  | { type: 'progress'; id: number; done: number; total: number; symbol: string }
  | { type: 'result'; id: number; result: ScanResult }
  | { type: 'done'; id: number }
  | { type: 'fatal'; id: number; error: string };
