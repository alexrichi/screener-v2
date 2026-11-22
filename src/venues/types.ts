export type VenueId = string;
export type MarketKind = 'spot' | 'perp';
export type Unsubscribe = () => void;

/** One tradable instrument, normalized across venues. */
export interface Instrument {
  /** Stable identity: venue:kind:nativeId. */
  key: string;
  venue: VenueId;
  /** The venue's exact ticker: BTCUSDT, BTC-USDT-SWAP, ... */
  nativeId: string;
  /** Human-facing name: BTCUSDT.P for perps, BTCUSDT or BTC/USD for spot. */
  display: string;
  /** The symbol handed to Vela, including the provider prefix. */
  velaSymbol: string;
  base: string;
  quote: string;
  kind: MarketKind;
  /** Price decimals used by the table, from the venue's tick size. */
  pricePrecision: number;
  /** Actual price step (e.g. 0.1), when the venue exposes it. */
  tickSize?: number;
  /** Base units per contract, for venues that quote derivatives in contracts. */
  contractSize?: number;
}

export interface VenueBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

/** A normalized quote. Fields the venue does not serve stay null. */
export interface VenueTicker {
  instrument: Instrument;
  last: number | null;
  change24h: number | null;
  quoteVolume: number | null;
  funding: number | null;
  nextFunding: number | null;
}

export interface VenueCapabilities {
  markets: MarketKind[];
  stream: boolean;
  funding: boolean;
  trading: boolean;
}

export interface RateLimitBucket {
  /** Adapter-defined bucket id, e.g. candles / history-candles / private. */
  id: string;
  type: 'weight' | 'requests';
  limit: number;
  windowMs: number;
}

export interface RateLimitPolicy {
  buckets: readonly RateLimitBucket[];
  maxConcurrent: number;
}

/** Interactive work (charts, the table) wins over background scans. */
export type RequestPriority = 'interactive' | 'background';

export interface VenueFetchOptions {
  includeForming?: boolean;
  /** Start of the window (epoch ms); adapters that support it pass startTime/after. */
  from?: number;
  to?: number;
  priority?: RequestPriority;
}

export interface VenueAdapter {
  id: VenueId;
  label: string;
  capabilities: VenueCapabilities;
  rateLimit: RateLimitPolicy;

  listInstruments(signal?: AbortSignal): Promise<Instrument[]>;
  fetchTickers(signal?: AbortSignal): Promise<VenueTicker[]>;
  fetchBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    signal?: AbortSignal,
    opts?: VenueFetchOptions,
  ): Promise<VenueBar[]>;

  subscribeBars?(
    instrument: Instrument,
    timeframe: string,
    onBar: (bar: VenueBar) => void,
  ): Unsubscribe;

  /** Stop a venue-wide auxiliary socket (OKX funding) when the screener drops it. */
  stopFunding?(): void;

  /** Sidecar-only: the browser never receives venue credentials. */
  trading?: TradingPort;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus =
  | 'pending'
  | 'open'
  | 'partially-filled'
  | 'filled'
  | 'canceled'
  | 'rejected';

export interface VenueOrder {
  id: string;
  instrumentKey: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: number | null;
  quantity: number;
  filledQuantity: number;
  createdAt: number;
  updatedAt: number;
}

export interface VenuePosition {
  instrumentKey: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  leverage: number | null;
}

export interface VenueFill {
  id: string;
  orderId: string;
  instrumentKey: string;
  side: OrderSide;
  price: number;
  quantity: number;
  fee: number | null;
  feeCurrency: string | null;
  time: number;
}

export interface VenueBalance {
  currency: string;
  free: number;
  used: number;
  total: number;
}

export interface VenueAccount {
  venue: VenueId;
  balances: VenueBalance[];
}

export interface PlaceOrderRequest {
  instrumentKey: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  reduceOnly?: boolean;
  clientId?: string;
}

export interface AmendOrderRequest {
  price?: number;
  quantity?: number;
}

/** The private trading surface. Implemented only inside the future sidecar. */
export interface TradingPort {
  getAccount(): Promise<VenueAccount>;
  getPositions(): Promise<VenuePosition[]>;
  getOpenOrders(): Promise<VenueOrder[]>;
  placeOrder(request: PlaceOrderRequest): Promise<VenueOrder>;
  amendOrder(orderId: string, request: AmendOrderRequest): Promise<VenueOrder>;
  cancelOrder(orderId: string): Promise<void>;

  subscribeOrders?(handler: (order: VenueOrder) => void): Unsubscribe;
  subscribePositions?(handler: (position: VenuePosition) => void): Unsubscribe;
  subscribeFills?(handler: (fill: VenueFill) => void): Unsubscribe;
}
