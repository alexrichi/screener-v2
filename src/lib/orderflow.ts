import type { MarketKind, VenueId } from '../venues/types';
import { formatCompact } from './format';

export type OrderFlowSide = 'buy' | 'sell';
export type OrderFlowTab = 'book' | 'dom' | 'trades';
export type SizeUnit = 'base' | 'quote';
export type BookDepthStyle = 'bars' | 'area' | 'area-line' | 'line';
export type BookDepthTotal = 'running' | 'level';
export type DomFollow = 'fixed' | 'auto' | 'timed';
export type HighlightMode = 'relative' | 'amount';
export type DomColumnId =
  | 'sold'
  | 'bid'
  | 'price'
  | 'ask'
  | 'bought'
  | 'delta'
  | 'volume'
  | 'last';

export interface OrderFlowLevel {
  price: number;
  size: number;
}

export interface OrderFlowVenueBook {
  venue: VenueId;
  bids: OrderFlowLevel[];
  asks: OrderFlowLevel[];
  at: number;
}

/** The sidecar's aggregated ladder, already grouped at the requested step. */
export interface OrderFlowBook {
  bids: OrderFlowLevel[];
  asks: OrderFlowLevel[];
  venues: VenueId[];
  at: number;
}

export interface OrderFlowTrade {
  /** Venue trade id, unique inside the venue. */
  id: string;
  venue: VenueId;
  price: number;
  size: number;
  side: OrderFlowSide;
  time: number;
  /** Fills of one order share this id (for Combine fills). */
  group?: string;
}

export interface OrderFlowPeer {
  venue: VenueId;
  instrumentKey: string;
  display: string;
  kind: MarketKind;
  tickSize: number;
}

export type OrderFlowFrame =
  | {
      type: 'ready';
      symbol: string;
      base: string;
      quote: string;
      kind: MarketKind;
      peers: OrderFlowPeer[];
      tickSize: number;
      pricePrecision: number;
    }
  | {
      type: 'book';
      bids: OrderFlowLevel[];
      asks: OrderFlowLevel[];
      venues: VenueId[];
      stale: VenueId[];
      at: number;
    }
  | { type: 'trades'; trades: OrderFlowTrade[] }
  | { type: 'warning'; venue?: VenueId; message: string }
  | { type: 'error'; message: string };

export type OrderFlowClientMessage =
  | {
      type: 'subscribe';
      symbol: string;
      venues?: VenueId[] | null;
      grouping?: number | null;
    }
  | { type: 'venues'; venues: VenueId[] | null }
  | { type: 'grouping'; value: number | null }
  | { type: 'unsubscribe' };

export interface OrderFlowBucket {
  buy: number;
  sell: number;
}

export interface OrderFlowState {
  status: 'connecting' | 'live' | 'error';
  error: string | null;
  symbol: string;
  base: string;
  quote: string;
  kind: MarketKind;
  peers: OrderFlowPeer[];
  tickSize: number;
  pricePrecision: number;
  book: OrderFlowBook | null;
  stale: VenueId[];
  trades: OrderFlowTrade[];
  /** venue → price/fineStep → traded size. */
  buckets: Record<string, Map<number, OrderFlowBucket>>;
  startedAt: number;
  warnings: Array<{ venue?: VenueId; message: string; at: number }>;
}

export interface OrderFlowColumn {
  id: DomColumnId;
  visible: boolean;
}

export interface OrderFlowSettings {
  tab: OrderFlowTab;
  /** Combined reads every included venue; a venue id reads only that one. */
  source: 'combined' | VenueId;
  /** null means every resolved peer; [] means none. */
  venues: VenueId[] | null;
  /** null follows the instrument's price; a number is an explicit step. */
  grouping: number | null;
  book: {
    unit: SizeUnit;
    style: BookDepthStyle;
    total: BookDepthTotal;
    zoom: number;
    bidColor: string;
    askColor: string;
  };
  dom: {
    unit: SizeUnit;
    follow: DomFollow;
    timedSec: 5 | 10 | 30 | 60;
    columns: OrderFlowColumn[];
    highlight: HighlightMode;
    multiplier: number;
    amount: number;
    zoom: number;
    bidColor: string;
    askColor: string;
  };
  trades: {
    unit: SizeUnit;
    min: number | null;
    max: number | null;
    highlight: HighlightMode;
    multiplier: number;
    amount: number;
    combine: boolean;
    freeze: boolean;
    ms: boolean;
    zoom: number;
    bidColor: string;
    askColor: string;
  };
}

/**
 * Panel settings are stored per instrument. The visible tab and the included
 * venue list are panel-wide; source, grouping and the three view settings follow
 * the chart symbol.
 */
export interface OrderFlowPreferences {
  version: 1;
  tab: OrderFlowTab;
  venues: VenueId[] | null;
  symbols: Record<string, OrderFlowSettings>;
}

export const DEFAULT_DOM_COLUMNS: OrderFlowColumn[] = [
  { id: 'sold', visible: true },
  { id: 'bid', visible: true },
  { id: 'price', visible: true },
  { id: 'ask', visible: true },
  { id: 'bought', visible: true },
  { id: 'delta', visible: true },
  { id: 'volume', visible: false },
  { id: 'last', visible: false },
];

export const DEFAULT_ORDER_FLOW_SETTINGS: OrderFlowSettings = {
  tab: 'dom',
  source: 'combined',
  venues: null,
  grouping: null,
  book: {
    unit: 'base',
    style: 'bars',
    total: 'level',
    zoom: 100,
    bidColor: '#089981',
    askColor: '#f23645',
  },
  dom: {
    unit: 'base',
    follow: 'auto',
    timedSec: 10,
    columns: DEFAULT_DOM_COLUMNS,
    highlight: 'relative',
    multiplier: 3,
    amount: 50000,
    zoom: 100,
    bidColor: '#089981',
    askColor: '#f23645',
  },
  trades: {
    unit: 'base',
    min: null,
    max: null,
    highlight: 'relative',
    multiplier: 3,
    amount: 50000,
    combine: true,
    freeze: true,
    ms: false,
    zoom: 100,
    bidColor: '#089981',
    askColor: '#f23645',
  },
};

const TABS: OrderFlowTab[] = ['book', 'dom', 'trades'];
const UNITS: SizeUnit[] = ['base', 'quote'];
const STYLES: BookDepthStyle[] = ['bars', 'area', 'area-line', 'line'];
const TOTALS: BookDepthTotal[] = ['running', 'level'];
const FOLLOWS: DomFollow[] = ['fixed', 'auto', 'timed'];
const HIGHLIGHTS: HighlightMode[] = ['relative', 'amount'];
const COLUMN_IDS: DomColumnId[] = [
  'sold',
  'bid',
  'price',
  'ask',
  'bought',
  'delta',
  'volume',
  'last',
];
const TIMED = [5, 10, 30, 60];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function zoomOk(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 70 && value <= 160;
}

function colorOk(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function positiveOk(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function amountOk(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function columnsOk(value: unknown): value is OrderFlowColumn[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) && oneOf(entry.id, COLUMN_IDS) && typeof entry.visible === 'boolean',
    )
  );
}

export function isOrderFlowSettings(value: unknown): value is OrderFlowSettings {
  if (!isRecord(value)) return false;
  if (!oneOf(value.tab, TABS) || typeof value.source !== 'string' || !value.source) return false;
  if (value.venues !== null && !Array.isArray(value.venues)) return false;
  if (Array.isArray(value.venues) && !value.venues.every((item) => typeof item === 'string')) {
    return false;
  }
  if (value.grouping !== null && !positiveOk(value.grouping)) return false;
  const book = value.book;
  const dom = value.dom;
  const trades = value.trades;
  if (!isRecord(book) || !isRecord(dom) || !isRecord(trades)) return false;
  if (!oneOf(book.unit, UNITS) || !oneOf(book.style, STYLES) || !oneOf(book.total, TOTALS)) {
    return false;
  }
  if (!zoomOk(book.zoom) || !colorOk(book.bidColor) || !colorOk(book.askColor)) return false;
  if (!oneOf(dom.unit, UNITS) || !oneOf(dom.follow, FOLLOWS)) return false;
  if (!TIMED.includes(dom.timedSec as number)) return false;
  if (!oneOf(dom.highlight, HIGHLIGHTS)) return false;
  if (!columnsOk(dom.columns)) return false;
  if (!positiveOk(dom.multiplier) || !amountOk(dom.amount)) return false;
  if (!zoomOk(dom.zoom) || !colorOk(dom.bidColor) || !colorOk(dom.askColor)) return false;
  if (!oneOf(trades.unit, UNITS) || !oneOf(trades.highlight, HIGHLIGHTS)) return false;
  if (trades.min !== null && !amountOk(trades.min)) return false;
  if (trades.max !== null && !amountOk(trades.max)) return false;
  if (trades.min !== null && trades.max !== null && trades.max < trades.min) return false;
  if (typeof trades.combine !== 'boolean' || typeof trades.freeze !== 'boolean') return false;
  if (typeof trades.ms !== 'boolean') return false;
  if (!positiveOk(trades.multiplier) || !amountOk(trades.amount)) return false;
  return zoomOk(trades.zoom) && colorOk(trades.bidColor) && colorOk(trades.askColor);
}

export const DEFAULT_ORDER_FLOW_PREFERENCES: OrderFlowPreferences = {
  version: 1,
  tab: 'dom',
  venues: null,
  symbols: {},
};

export function isOrderFlowPreferences(value: unknown): value is OrderFlowPreferences {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!oneOf(value.tab, TABS)) return false;
  if (value.venues !== null && !Array.isArray(value.venues)) return false;
  if (Array.isArray(value.venues) && !value.venues.every((item) => typeof item === 'string')) {
    return false;
  }
  if (!isRecord(value.symbols)) return false;
  return Object.values(value.symbols).every((entry) => isOrderFlowSettings(entry));
}

/** Stable per-instrument key: bare Binance symbols gain their provider. */
export function orderFlowSymbolKey(symbol: string): string {
  const at = symbol.indexOf(':');
  const provider = at >= 0 ? symbol.slice(0, at).toUpperCase() : 'BINANCE';
  const ticker = (at >= 0 ? symbol.slice(at + 1) : symbol).toUpperCase();
  return `${provider}:${ticker}`;
}

/** Resolve the current instrument's stored settings over the panel-wide tab/venues. */
export function settingsForSymbol(
  preferences: OrderFlowPreferences,
  symbol: string,
): OrderFlowSettings {
  const key = orderFlowSymbolKey(symbol);
  const saved = preferences.symbols[key] ?? DEFAULT_ORDER_FLOW_SETTINGS;
  return {
    ...saved,
    tab: preferences.tab,
    venues: preferences.venues,
  };
}

function normalizePrice(value: number): number {
  return Number(value.toPrecision(12));
}

export function priceKey(price: number, step: number): number {
  return Math.round(price / step);
}

/** Merged book keyed by the grouping step, best prices first. */
export function mergeBooks(
  books: readonly OrderFlowVenueBook[],
  step: number,
  limit = 100,
): { bids: OrderFlowLevel[]; asks: OrderFlowLevel[]; venues: number } {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  let venues = 0;
  for (const book of books) {
    if (book.bids.length === 0 && book.asks.length === 0) continue;
    venues += 1;
    for (const level of book.bids) {
      if (!(level.size > 0)) continue;
      const key = priceKey(level.price, step);
      bids.set(key, (bids.get(key) ?? 0) + level.size);
    }
    for (const level of book.asks) {
      if (!(level.size > 0)) continue;
      const key = priceKey(level.price, step);
      asks.set(key, (asks.get(key) ?? 0) + level.size);
    }
  }
  return {
    bids: toLevels(bids, step, 'bid', limit),
    asks: toLevels(asks, step, 'ask', limit),
    venues,
  };
}

function toLevels(
  levels: Map<number, number>,
  step: number,
  side: 'bid' | 'ask',
  limit: number,
): OrderFlowLevel[] {
  return [...levels.entries()]
    .sort((left, right) => (side === 'bid' ? right[0] - left[0] : left[0] - right[0]))
    .slice(0, limit)
    .map(([key, size]) => ({ price: normalizePrice(key * step), size }));
}

/** Rebuckets the tick-level trade totals onto the visible price step. */
export function mergeTradeTotals(
  buckets: Record<string, Map<number, OrderFlowBucket>>,
  venues: readonly VenueId[],
  fineStep: number,
  step: number,
): Map<number, OrderFlowBucket> {
  const totals = new Map<number, OrderFlowBucket>();
  if (!(fineStep > 0)) return totals;
  for (const venue of venues) {
    const rows = buckets[venue];
    if (!rows) continue;
    for (const [key, value] of rows) {
      const bucket = priceKey(key * fineStep, step);
      const current = totals.get(bucket) ?? { buy: 0, sell: 0 };
      current.buy += value.buy;
      current.sell += value.sell;
      totals.set(bucket, current);
    }
  }
  return totals;
}

/** Price steps offered by the Group prices control, scaled to the instrument. */
export function groupingOptions(mid: number, tick: number): number[] {
  const price = mid > 0 ? mid : tick;
  const magnitude = price > 0 ? 10 ** (Math.floor(Math.log10(price)) - 4) : tick;
  const base = Math.max(tick > 0 ? tick : 0, magnitude, 1e-12);
  const fine = tick > 0 ? [1, 2, 5, 10].map((factor) => normalizePrice(tick * factor)) : [];
  const coarse = [1, 2, 5, 10, 100, 1000].map((factor) => normalizePrice(base * factor));
  return [...new Set([...fine, ...coarse])].sort((left, right) => left - right);
}

/** The default step shows roughly 1/500th of the price per ladder row. */
export function autoGrouping(mid: number, tick: number): number {
  const options = groupingOptions(mid, tick);
  const target = mid > 0 ? mid / 500 : options[0]!;
  let best = options[0]!;
  let distance = Infinity;
  for (const option of options) {
    const next = Math.abs(Math.log(option / target));
    if (next < distance) {
      distance = next;
      best = option;
    }
  }
  return best;
}

export function spreadBps(bestBid: number | null, bestAsk: number | null): number | null {
  if (!bestBid || !bestAsk || bestAsk < bestBid) return null;
  const mid = (bestBid + bestAsk) / 2;
  return ((bestAsk - bestBid) / mid) * 10_000;
}

/** One row per order when the venue exposes an order id; otherwise a 10 ms estimate. */
export function combineFills(trades: readonly OrderFlowTrade[]): OrderFlowTrade[] {
  const merged = new Map<string, OrderFlowTrade>();
  for (const trade of trades) {
    const key = trade.group
      ? `${trade.venue}|${trade.group}`
      : `${trade.venue}|${trade.side}|${trade.price}|${Math.floor(trade.time / 10)}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, trade);
      continue;
    }
    merged.set(key, {
      ...current,
      size: current.size + trade.size,
      time: Math.max(current.time, trade.time),
    });
  }
  return [...merged.values()].sort((left, right) => right.time - left.time);
}

export function formatBaseSize(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1000) return formatCompact(value);
  if (abs < 1e-4) return value.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '');
  const digits = abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatQuoteSize(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return formatCompact(value);
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatSize(value: number | null, unit: SizeUnit, price = 1): string {
  return unit === 'quote' ? formatQuoteSize(value === null ? null : value * price) : formatBaseSize(value);
}

export function formatGrouping(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

export function formatTradeTime(ms: number, withMs: boolean): string {
  const date = new Date(ms);
  const clock = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return withMs ? `${clock}.${String(date.getUTCMilliseconds()).padStart(3, '0')}` : clock;
}

export function formatSince(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

export const EMPTY_ORDER_FLOW_STATE: OrderFlowState = {
  status: 'connecting',
  error: null,
  symbol: '',
  base: '',
  quote: '',
  kind: 'perp',
  peers: [],
  tickSize: 0,
  pricePrecision: 2,
  book: null,
  stale: [],
  trades: [],
  buckets: {},
  startedAt: 0,
  warnings: [],
};

export type OrderFlowAction =
  | { type: 'connecting' }
  | { type: 'open' }
  | { type: 'frame'; frame: OrderFlowFrame }
  | { type: 'drop'; venues: VenueId[] }
  | { type: 'reset-window' }
  | { type: 'reset' };

export function orderFlowReducer(
  state: OrderFlowState,
  action: OrderFlowAction,
): OrderFlowState {
  if (action.type === 'reset') return EMPTY_ORDER_FLOW_STATE;
  if (action.type === 'connecting') {
    return state.status === 'connecting' ? state : { ...state, status: 'connecting', error: null };
  }
  if (action.type === 'open') return { ...state, error: null };
  if (action.type === 'reset-window') {
    return { ...state, trades: [], buckets: {}, startedAt: Date.now() };
  }
  if (action.type === 'drop') {
    if (action.venues.length === 0) return state;
    const drop = new Set(action.venues);
    const buckets = { ...state.buckets };
    for (const venue of drop) delete buckets[venue];
    return {
      ...state,
      buckets,
      stale: state.stale.filter((venue) => !drop.has(venue)),
      trades: state.trades.filter((trade) => !drop.has(trade.venue)),
    };
  }

  const frame = action.frame;
  if (frame.type === 'ready') {
    const same =
      state.symbol !== '' && state.symbol === frame.symbol && state.tickSize === frame.tickSize;
    return {
      ...state,
      status: 'live',
      error: null,
      symbol: frame.symbol,
      base: frame.base,
      quote: frame.quote,
      kind: frame.kind,
      peers: frame.peers,
      tickSize: frame.tickSize,
      pricePrecision: frame.pricePrecision,
      book: same ? state.book : null,
      stale: same ? state.stale : [],
      trades: same ? state.trades : [],
      buckets: same ? state.buckets : {},
      startedAt: same && state.startedAt > 0 ? state.startedAt : Date.now(),
      warnings: same ? state.warnings : [],
    };
  }
  if (frame.type === 'book') {
    return {
      ...state,
      status: 'live',
      error: null,
      stale: frame.stale,
      book: {
        bids: frame.bids,
        asks: frame.asks,
        venues: frame.venues,
        at: frame.at,
      },
    };
  }
  if (frame.type === 'trades') {
    if (frame.trades.length === 0) return state;
    const trades = [...state.trades, ...frame.trades]
      .sort((left, right) => left.time - right.time)
      .slice(-10_000);
    let buckets = state.buckets;
    if (state.tickSize > 0) {
      const next = { ...state.buckets };
      const changed = new Map<string, Map<number, OrderFlowBucket>>();
      for (const trade of frame.trades) {
        let rows = changed.get(trade.venue);
        if (!rows) {
          rows = new Map(next[trade.venue] ?? []);
          changed.set(trade.venue, rows);
        }
        const key = Math.round(trade.price / state.tickSize);
        const current = rows.get(key) ?? { buy: 0, sell: 0 };
        rows.set(
          key,
          trade.side === 'buy'
            ? { ...current, buy: current.buy + trade.size }
            : { ...current, sell: current.sell + trade.size },
        );
      }
      for (const [venue, rows] of changed) next[venue] = rows;
      buckets = next;
    }
    return { ...state, status: 'live', error: null, trades, buckets };
  }
  if (frame.type === 'warning') {
    return {
      ...state,
      warnings: [
        ...state.warnings,
        { venue: frame.venue, message: frame.message, at: Date.now() },
      ].slice(-5),
    };
  }
  return { ...state, status: 'error', error: frame.message };
}
