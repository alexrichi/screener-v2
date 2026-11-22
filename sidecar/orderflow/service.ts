import type {
  OrderFlowClientMessage,
  OrderFlowFrame,
  OrderFlowLevel,
  OrderFlowPeer,
  OrderFlowTrade,
} from '../../src/lib/orderflow';
import { autoGrouping, resolveVenueSelection } from '../../src/lib/orderflow';
import { findPineInstrument } from '../../src/lib/pineVela/seriesHost';
import type { Instrument, MarketKind } from '../../src/venues/types';
import type { VenueHub } from '../hub';
import type { FeedHandlers, OrderFlowFeed } from './feeds';

const USD_QUOTES = new Set(['USD', 'USDT', 'USDC']);
const STALE_MS = 15_000;
const TICK_MS = 100;
const TRADE_BATCH = 500;
const BOOK_LEVELS = 100;

interface Peer {
  instrument: Instrument;
  tick: number;
}

interface RawBook {
  bids: OrderFlowLevel[];
  asks: OrderFlowLevel[];
  at: number;
}

interface Resolved {
  primary: Instrument;
  peers: Peer[];
}

export function choosePeer(
  instruments: readonly Instrument[],
  base: string,
  quote: string,
  kind: MarketKind,
  primaryKey: string,
): Instrument | undefined {
  const wantedBase = base.toUpperCase();
  const wantedQuote = quote.toUpperCase();
  let best: Instrument | undefined;
  let score = -1;
  for (const instrument of instruments) {
    if (instrument.base.toUpperCase() !== wantedBase) continue;
    if (!USD_QUOTES.has(instrument.quote.toUpperCase())) continue;
    const sameKind = instrument.kind === kind;
    const next =
      (instrument.key === primaryKey ? 100 : 0) +
      (sameKind && instrument.quote.toUpperCase() === wantedQuote ? 10 : 0) +
      (sameKind ? 5 : 0) +
      (instrument.kind === 'spot' && instrument.quote.toUpperCase() === 'USD' ? 4 : 0) +
      (instrument.kind === 'perp' ? 1 : 0);
    if (next > score) {
      score = next;
      best = instrument;
    }
  }
  return best;
}

/**
 * Both markets a venue lists for one asset. Binance runs spot and USDⓈ-M side
 * by side, so a BTCUSDT.P chart reads seven books, not six.
 */
export function choosePeers(
  instruments: readonly Instrument[],
  base: string,
  quote: string,
  kind: MarketKind,
  primaryKey: string,
): Instrument[] {
  const chosen = choosePeer(instruments, base, quote, kind, primaryKey);
  if (!chosen) return [];
  const otherKind: MarketKind = chosen.kind === 'perp' ? 'spot' : 'perp';
  const other = choosePeer(
    instruments.filter((item) => item.kind === otherKind),
    base,
    quote,
    kind,
    primaryKey,
  );
  return other && other.key !== chosen.key ? [chosen, other] : [chosen];
}

/**
 * The wire include list accepts an instrument key, a stable `venue:kind` id, or
 * a legacy venue id. Both subscribe and later updates go through this matcher.
 */
export function selectPeerKeys(
  peers: readonly OrderFlowPeer[],
  wanted: readonly string[] | null,
): Set<string> {
  const available = peers.map((peer) => peer.instrumentKey);
  return new Set(resolveVenueSelection(peers, wanted) ?? available);
}

async function resolve(
  hubs: Map<string, VenueHub>,
  symbol: string,
): Promise<Resolved | null> {
  const at = symbol.indexOf(':');
  const prefix = at > 0 ? symbol.slice(0, at).toLowerCase() : '';
  let primary: Instrument | undefined;
  if (prefix) {
    const hub = hubs.get(prefix);
    if (hub) primary = findPineInstrument(await hub.getInstruments(), symbol);
  }
  if (!primary) {
    const ordered = [...hubs.entries()].sort(([left], [right]) => {
      if (left === 'binance') return -1;
      if (right === 'binance') return 1;
      return 0;
    });
    for (const [, hub] of ordered) {
      primary = findPineInstrument(await hub.getInstruments(), symbol);
      if (primary) break;
    }
  }
  if (!primary) return null;

  const peers: Peer[] = [];
  for (const [, hub] of hubs) {
    const instruments = await hub.getInstruments();
    for (const instrument of choosePeers(
      instruments,
      primary.base,
      primary.quote,
      primary.kind,
      primary.key,
    )) {
      const tick =
        instrument.tickSize && instrument.tickSize > 0
          ? instrument.tickSize
          : 10 ** -instrument.pricePrecision;
      peers.push({ instrument, tick });
    }
  }
  if (peers.length === 0) return null;
  return { primary, peers };
}

/** Sum one venue's raw levels into the price step the ladder displays. */
export function groupLevels(
  levels: readonly OrderFlowLevel[],
  step: number,
  side: 'bid' | 'ask',
  limit = BOOK_LEVELS,
): OrderFlowLevel[] {
  if (!(step > 0)) return [];
  const grouped = new Map<number, number>();
  for (const level of levels) {
    if (!(level.price > 0) || !(level.size > 0)) continue;
    const key = Math.round(level.price / step);
    grouped.set(key, (grouped.get(key) ?? 0) + level.size);
  }
  return [...grouped.entries()]
    .sort((left, right) => (side === 'bid' ? right[0] - left[0] : left[0] - right[0]))
    .slice(0, limit)
    .map(([key, size]) => ({ price: Number((key * step).toPrecision(12)), size }));
}

function best(books: Map<string, RawBook>, selected: Set<string>): { bid: number; ask: number } {
  let bid = 0;
  let ask = 0;
  for (const [peer, book] of books) {
    if (!selected.has(peer)) continue;
    const nextBid = book.bids[0]?.price ?? 0;
    const nextAsk = book.asks[0]?.price ?? 0;
    if (nextBid > bid) bid = nextBid;
    if (nextAsk > 0 && (ask === 0 || nextAsk < ask)) ask = nextAsk;
  }
  return { bid, ask };
}

/**
 * The sidecar's combined ladder: clip each venue around the chart venue's mid,
 * group at the requested step, and keep the 100 best levels a side. This is the
 * snapshot the browser receives; the client never merges raw venue books.
 */
export function combineBook(
  books: Map<string, RawBook>,
  selected: Set<string>,
  primaryPeer: string | undefined,
  step: number,
  now = Date.now(),
): { bids: OrderFlowLevel[]; asks: OrderFlowLevel[]; peers: string[] } {
  const primary = primaryPeer ? books.get(primaryPeer) : undefined;
  let refBid = primary?.bids[0]?.price ?? 0;
  let refAsk = primary?.asks[0]?.price ?? 0;
  if (!(refBid > 0) || !(refAsk > 0)) {
    const fallback = best(books, selected);
    refBid = refBid || fallback.bid;
    refAsk = refAsk || fallback.ask;
  }
  const refMid = refBid > 0 && refAsk > 0 ? (refBid + refAsk) / 2 : refBid || refAsk || 0;
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  const peers: string[] = [];
  for (const [peer, book] of books) {
    if (!selected.has(peer) || now - book.at > STALE_MS) continue;
    const bidLevels = refMid > 0 ? book.bids.filter((level) => level.price <= refMid) : book.bids;
    const askLevels = refMid > 0 ? book.asks.filter((level) => level.price >= refMid) : book.asks;
    const groupedBids = groupLevels(bidLevels, step, 'bid');
    const groupedAsks = groupLevels(askLevels, step, 'ask');
    if (groupedBids.length === 0 && groupedAsks.length === 0) continue;
    peers.push(peer);
    for (const level of groupedBids) bids.set(level.price, (bids.get(level.price) ?? 0) + level.size);
    for (const level of groupedAsks) asks.set(level.price, (asks.get(level.price) ?? 0) + level.size);
  }
  const topBids = [...bids.entries()]
    .sort((left, right) => right[0] - left[0])
    .slice(0, BOOK_LEVELS)
    .map(([price, size]) => ({ price, size }));
  const topAsks = [...asks.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(0, BOOK_LEVELS)
    .map(([price, size]) => ({ price, size }));
  return { bids: topBids, asks: topAsks, peers };
}

/**
 * One order-flow session per browser socket. The session owns the ref-counted
 * venue feeds, keeps raw books per venue, and sends one grouped combined book
 * plus the trade tape at 10 Hz.
 */
export class OrderFlowSession {
  private generation = 0;
  private closed = false;
  private primary: Instrument | null = null;
  private peers: Peer[] = [];
  private peerInfos: OrderFlowPeer[] = [];
  private selected = new Set<string>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly books = new Map<string, RawBook>();
  private readonly dirty = new Set<string>();
  private pending: OrderFlowTrade[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastStale = '';
  private grouping: number | null = null;
  private groupingDirty = true;

  constructor(
    private readonly hubs: Map<string, VenueHub>,
    private readonly feeds: Map<string, OrderFlowFeed>,
    private readonly send: (frame: OrderFlowFrame) => void,
  ) {}

  handle(message: OrderFlowClientMessage): void {
    if (message.type === 'subscribe') {
      void this.subscribe(message.symbol, message.venues ?? null, message.grouping ?? null);
      return;
    }
    if (message.type === 'venues') {
      this.select(message.venues);
      return;
    }
    if (message.type === 'grouping') {
      this.grouping = message.value && message.value > 0 ? message.value : null;
      this.groupingDirty = true;
      return;
    }
    if (message.type === 'unsubscribe') this.close();
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    this.stopFeeds();
    this.stopTimer();
    this.books.clear();
    this.pending = [];
    this.peerInfos = [];
  }

  private async subscribe(
    symbol: string,
    wanted: string[] | null,
    grouping: number | null,
  ): Promise<void> {
    const generation = ++this.generation;
    this.stopFeeds();
    this.stopTimer();
    this.books.clear();
    this.dirty.clear();
    this.pending = [];
    this.lastStale = '';
    this.selected.clear();
    this.grouping = grouping && grouping > 0 ? grouping : null;
    this.groupingDirty = true;
    if (!symbol) {
      this.send({ type: 'error', message: 'No symbol selected' });
      return;
    }
    let resolved: Resolved | null = null;
    try {
      resolved = await resolve(this.hubs, symbol);
    } catch (error) {
      if (generation !== this.generation || this.closed) return;
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (generation !== this.generation || this.closed) return;
    if (!resolved) {
      this.send({ type: 'error', message: `No order-flow feed for "${symbol}"` });
      return;
    }
    this.primary = resolved.primary;
    this.peers = resolved.peers;
    this.peerInfos = this.peers.map(({ instrument, tick }) => ({
      venue: instrument.venue,
      instrumentKey: instrument.key,
      display: instrument.display,
      kind: instrument.kind,
      tickSize: tick,
    }));
    this.send({
      type: 'ready',
      symbol,
      base: resolved.primary.base,
      quote: resolved.primary.quote,
      kind: resolved.primary.kind,
      peers: this.peerInfos,
      primary: resolved.primary.key,
      tickSize: Math.max(...this.peers.map((peer) => peer.tick)),
      pricePrecision: resolved.primary.pricePrecision,
    });
    this.select(wanted);
    this.startTimer();
  }

  private select(peers: string[] | null): void {
    if (this.closed || !this.primary) return;
    const next = selectPeerKeys(this.peerInfos, peers);
    if (sameSet(next, this.selected)) return;
    for (const [peer, unsubscribe] of this.subscriptions) {
      if (next.has(peer)) continue;
      unsubscribe();
      this.subscriptions.delete(peer);
      this.books.delete(peer);
      this.dirty.delete(peer);
    }
    this.pending = this.pending.filter((trade) => next.has(trade.peer));
    this.selected = next;
    this.groupingDirty = true;
    this.startFeeds();
  }

  private step(): number {
    const tick = this.peers.length > 0 ? Math.max(...this.peers.map((peer) => peer.tick)) : 1e-8;
    const primary = this.primary ? this.books.get(this.primary.key) : undefined;
    let bid = primary?.bids[0]?.price ?? 0;
    let ask = primary?.asks[0]?.price ?? 0;
    if (!(bid > 0) || !(ask > 0)) {
      const fallback = best(this.books, this.selected);
      bid = bid || fallback.bid;
      ask = ask || fallback.ask;
    }
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask || 0;
    const grouping = this.grouping ?? autoGrouping(mid, tick);
    return Math.max(grouping, tick);
  }

  private startFeeds(): void {
    if (this.closed) return;
    for (const peer of this.peers) {
      const key = peer.instrument.key;
      if (!this.selected.has(key) || this.subscriptions.has(key)) continue;
      const feed = this.feeds.get(peer.instrument.venue);
      if (!feed) continue;
      const unsubscribe = feed.subscribe(peer.instrument, {
        book: (levels) => {
          if (this.closed || !this.selected.has(key)) return;
          this.books.set(key, { bids: levels.bids, asks: levels.asks, at: Date.now() });
          this.dirty.add(key);
        },
        trade: (trade) => {
          if (this.closed || !this.selected.has(key)) return;
          this.pending.push({ ...trade, venue: peer.instrument.venue, peer: key });
        },
        warning: (message) => {
          if (this.closed) return;
          this.send({ type: 'warning', venue: peer.instrument.venue, message });
        },
      } satisfies FeedHandlers);
      this.subscriptions.set(key, unsubscribe);
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), TICK_MS);
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private stopFeeds(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }

  private flush(): void {
    if (this.closed) return;
    const now = Date.now();
    const stale: string[] = [];
    for (const [peer, book] of this.books) {
      if (now - book.at > STALE_MS) stale.push(peer);
    }
    const staleKey = stale.join(',');
    if (
      this.groupingDirty ||
      this.dirty.size > 0 ||
      staleKey !== this.lastStale
    ) {
      const combined = combineBook(
        this.books,
        this.selected,
        this.primary?.key,
        this.step(),
        now,
      );
      this.lastStale = staleKey;
      this.groupingDirty = false;
      this.dirty.clear();
      this.send({ type: 'book', ...combined, stale, at: now });
    }
    if (this.pending.length > 0) {
      const batch = this.pending.splice(0, TRADE_BATCH);
      this.send({ type: 'trades', trades: batch });
    }
  }
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export class OrderFlowService {
  constructor(
    private readonly hubs: Map<string, VenueHub>,
    private readonly feeds: Map<string, OrderFlowFeed>,
  ) {}

  session(send: (frame: OrderFlowFrame) => void): OrderFlowSession {
    return new OrderFlowSession(this.hubs, this.feeds, send);
  }
}
