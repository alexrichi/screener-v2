import { Popover } from '@base-ui/react';
import { ChevronDown, Info, Pause, Play, Settings2, Target } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useOrderFlow } from '../hooks/useOrderFlow';
import { formatPrice } from '../lib/format';
import {
  autoGrouping,
  combineFills,
  DEFAULT_ORDER_FLOW_PREFERENCES,
  formatBaseSize,
  formatGrouping,
  formatQuoteSize,
  formatSince,
  formatSize,
  formatTradeTime,
  groupingOptions,
  isOrderFlowPreferences,
  mergeTradeTotals,
  orderFlowSymbolKey,
  priceKey,
  settingsForSymbol,
  spreadBps,
  type OrderFlowBook,
  type OrderFlowLevel,
  type OrderFlowSettings,
  type OrderFlowState,
  type OrderFlowTab,
  type OrderFlowTrade,
} from '../lib/orderflow';
import { usePersistedState } from '../lib/usePersistedState';
import { venueLabel } from '../venues/catalog';
import { VenueIcon } from '../venues/venueIcons';
import type { VenueId } from '../venues/types';
import { Segmented } from '../ui/primitives';
import { PopoverContent } from '../ui/overlays';
import { OrderFlowSettings as SettingsBody } from './OrderFlowSettings';

const ROW_BASE = 16;
const DOM_PAD_ROWS = 24;
const FIXED_COLUMNS = new Set(['bid', 'price', 'ask']);
const COLUMN_LABELS: Record<string, string> = {
  sold: 'Sold',
  bid: 'Bid',
  price: 'Price',
  ask: 'Ask',
  bought: 'Bought',
  delta: 'Delta',
  volume: 'Volume',
  last: 'Last',
};
const TABS = [
  { value: 'book' as const, label: 'Book' },
  { value: 'dom' as const, label: 'DOM' },
  { value: 'trades' as const, label: 'Trades' },
];

interface PanelProps {
  /** Active chart symbol, e.g. BINANCE:BTCUSDT.P. */
  symbol: string;
}

function decimalsForStep(step: number): number {
  if (!(step > 0)) return 2;
  return step >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(step)));
}

/** A zero level is an empty cell on the ladder, not a printed zero. */
function domSize(value: number | undefined, unit: 'base' | 'quote', price = 1): string {
  if (value === undefined || !(value > 0)) return '';
  const text = formatSize(value, unit, price);
  return /^[0.,]+$/.test(text) ? '' : text;
}

function currency(value: number): string {
  return formatQuoteSize(value);
}

function sideColor(
  settings: { bidColor: string; askColor: string },
  side: 'buy' | 'sell',
): string {
  return side === 'buy' ? settings.bidColor : settings.askColor;
}

function running(levels: readonly OrderFlowLevel[]): Array<{
  level: OrderFlowLevel;
  base: number;
  quote: number;
}> {
  let base = 0;
  let quote = 0;
  return levels.map((level) => {
    base += level.size;
    quote += level.size * level.price;
    return { level, base, quote };
  });
}

function BookRow({
  level,
  side,
  text,
  share,
  decimals,
  zoom,
  style,
  bidColor,
  askColor,
}: {
  level: OrderFlowLevel;
  side: 'bid' | 'ask';
  text: string;
  share: number;
  decimals: number;
  zoom: number;
  style: OrderFlowSettings['book']['style'];
  bidColor: string;
  askColor: string;
}) {
  const color = side === 'bid' ? bidColor : askColor;
  const line = style === 'line' || style === 'area-line';
  const height = Math.max(13, Math.round(ROW_BASE * (zoom / 100)));
  return (
    <div
      className="relative flex items-center justify-between gap-2 px-2 font-mono text-[10.5px] tabular-nums"
      style={{ height, borderTop: line ? `1px solid ${color}55` : undefined }}
    >
      {(style === 'bars' || style === 'area' || style === 'area-line') && (
        <span
          className="pointer-events-none absolute inset-y-[1px] right-0 rounded-l-sm"
          style={{
            width: `${Math.max(0, Math.min(100, share))}%`,
            backgroundColor: color,
            opacity: style === 'bars' ? 0.22 : 0.12,
          }}
        />
      )}
      <span className="relative truncate" style={{ color }}>
        {formatPrice(level.price, decimals)}
      </span>
      <span className="relative text-foreground/90">{text}</span>
    </div>
  );
}

function BookTab({
  state,
  settings,
  book,
  step,
}: {
  state: OrderFlowState;
  settings: OrderFlowSettings;
  book: OrderFlowBook | null;
  step: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef<HTMLDivElement>(null);
  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];
  const decimals = decimalsForStep(step);
  const asksRunning = running(asks);
  const bidsRunning = running(bids);
  const maxSize = Math.max(1, ...asks.map((l) => l.size), ...bids.map((l) => l.size));
  const maxBase = Math.max(
    1,
    ...asksRunning.map((row) => row.base),
    ...bidsRunning.map((row) => row.base),
  );
  const bidTotal = bidsRunning.at(-1)?.base ?? 0;
  const askTotal = asksRunning.at(-1)?.base ?? 0;
  const bidPct = bidTotal + askTotal > 0 ? (bidTotal / (bidTotal + askTotal)) * 100 : 50;
  const spread = spreadBps(bids[0]?.price ?? null, asks[0]?.price ?? null);
  const unit = settings.book.unit;
  const value = (row: { level: OrderFlowLevel; base: number; quote: number }): number =>
    unit === 'quote'
      ? settings.book.total === 'running'
        ? row.quote
        : row.level.size * row.level.price
      : settings.book.total === 'running'
        ? row.base
        : row.level.size;
  const text = (row: { level: OrderFlowLevel; base: number; quote: number }): string =>
    unit === 'quote' ? formatQuoteSize(value(row)) : formatBaseSize(value(row));
  const share = (row: { level: OrderFlowLevel; base: number }): number =>
    settings.book.style === 'area' || settings.book.style === 'area-line'
      ? (row.base / maxBase) * 100
      : (row.level.size / maxSize) * 100;
  const centerBook = () => {
    const el = scrollRef.current;
    const row = spreadRef.current;
    if (!el || !row) return;
    const elRect = el.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    el.scrollTop += rowRect.top - elRect.top - el.clientHeight / 2 + rowRect.height / 2;
  };
  useEffect(() => {
    const el = scrollRef.current;
    const row = spreadRef.current;
    if (!el || !row) return;
    const elRect = el.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const y = rowRect.top - elRect.top;
    if (y < 24 || y > el.clientHeight - 24) centerBook();
    // Follow the spread only when it would leave the screen; scrolling away stays put.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, state.symbol, spread]);
  if (bids.length === 0 && asks.length === 0) {
    return <Empty text="Waiting for the book…" />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-6 shrink-0 items-center justify-between border-b border-border/60 px-2 text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Price</span>
        <span>
          {settings.book.total === 'running' ? 'Total' : 'Size'} ({unit === 'quote' ? state.quote || 'quote' : state.base || 'base'})
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {[...asksRunning].reverse().map((row) => (
          <BookRow
            key={`a-${row.level.price}`}
            level={row.level}
            side="ask"
            text={text(row)}
            share={share(row)}
            decimals={decimals}
            zoom={settings.book.zoom}
            style={settings.book.style}
            bidColor={settings.book.bidColor}
            askColor={settings.book.askColor}
          />
        ))}
        <div
          ref={spreadRef}
          className="flex h-6 items-center justify-center border-y border-border/60 bg-muted/20 text-[9.5px] text-muted-foreground"
        >
          {spread === null ? 'Spread —' : `Spread ${spread.toFixed(1)} bps`}
        </div>
        {bidsRunning.map((row) => (
          <BookRow
            key={`b-${row.level.price}`}
            level={row.level}
            side="bid"
            text={text(row)}
            share={share(row)}
            decimals={decimals}
            zoom={settings.book.zoom}
            style={settings.book.style}
            bidColor={settings.book.bidColor}
            askColor={settings.book.askColor}
          />
        ))}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border/60 px-2 text-[10px]">
        <span className="font-mono tabular-nums" style={{ color: settings.book.bidColor }}>
          B {bidPct.toFixed(0)}%
        </span>
        <div className="relative h-1 min-w-0 flex-1 overflow-hidden rounded bg-muted">
          <span
            className="absolute inset-y-0 left-0"
            style={{ width: `${bidPct}%`, backgroundColor: settings.book.bidColor }}
          />
          <span
            className="absolute inset-y-0 right-0"
            style={{ width: `${100 - bidPct}%`, backgroundColor: settings.book.askColor }}
          />
        </div>
        <span className="font-mono tabular-nums" style={{ color: settings.book.askColor }}>
          S {(100 - bidPct).toFixed(0)}%
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {spread === null ? '—' : `${spread.toFixed(1)} bps`}
        </span>
        <button
          type="button"
          onClick={centerBook}
          title="Center on the spread"
          className="inline-flex items-center gap-1 rounded px-1 text-[9.5px] text-foreground hover:bg-accent"
        >
          <Target className="size-3" /> Center
        </button>
      </div>
    </div>
  );
}

function DomTab({
  state,
  settings,
  book,
  venues,
  step,
  onReset,
}: {
  state: OrderFlowState;
  settings: OrderFlowSettings;
  book: OrderFlowBook | null;
  venues: VenueId[];
  step: number;
  onReset: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false);
  const holdUntil = useRef(0);
  const bookBids = book?.bids ?? [];
  const bookAsks = book?.asks ?? [];
  const bidMap = new Map(bookBids.map((level) => [priceKey(level.price, step), level.size]));
  const askMap = new Map(bookAsks.map((level) => [priceKey(level.price, step), level.size]));
  const bestBid = bookBids[0]?.price ?? 0;
  const bestAsk = bookAsks[0]?.price ?? 0;
  const bestBidKey = bestBid > 0 ? priceKey(bestBid, step) : 0;
  const bestAskKey = bestAsk > 0 ? priceKey(bestAsk, step) : 0;
  const lastPrice = state.trades.at(-1)?.price ?? 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || lastPrice;
  const centerKey = mid > 0 ? priceKey(mid, step) : 0;
  const top = centerKey + DOM_PAD_ROWS;
  const bottom = centerKey - DOM_PAD_ROWS;
  const keys: number[] = [];
  if (step > 0) for (let key = top; key >= bottom; key -= 1) keys.push(key);
  const totals = mergeTradeTotals(state.buckets, venues, state.tickSize, step);
  const lastSizes = new Map<number, number>();
  const now = Date.now();
  for (const trade of state.trades) {
    if (!venues.includes(trade.venue) || now - trade.time > 5_000) continue;
    lastSizes.set(priceKey(trade.price, step), trade.size);
  }
  const avgBid = bookBids.length
    ? bookBids.reduce((sum, level) => sum + level.size, 0) / bookBids.length
    : 0;
  const avgAsk = bookAsks.length
    ? bookAsks.reduce((sum, level) => sum + level.size, 0) / bookAsks.length
    : 0;
  const bidThreshold =
    settings.dom.highlight === 'relative' ? avgBid * settings.dom.multiplier : settings.dom.amount;
  const askThreshold =
    settings.dom.highlight === 'relative' ? avgAsk * settings.dom.multiplier : settings.dom.amount;
  const decimals = decimalsForStep(step);
  const rowHeight = Math.max(13, Math.round(ROW_BASE * (settings.dom.zoom / 100)));
  const columns = settings.dom.columns.filter(
    (column) => column.visible || FIXED_COLUMNS.has(column.id),
  );
  const template = columns.map((column) => (column.id === 'price' ? '1.25fr' : '1fr')).join(' ');
  const visibleHeight = () => scrollRef.current?.clientHeight ?? 0;
  const center = () => {
    const el = scrollRef.current;
    if (!el || keys.length === 0) return;
    const index = top - centerKey;
    if (index < 0 || index >= keys.length) return;
    el.scrollTop = Math.max(0, index * rowHeight - visibleHeight() / 2 + rowHeight / 2);
  };

  useEffect(() => {
    if (settings.dom.follow === 'fixed' || keys.length === 0) return;
    if (Date.now() < holdUntil.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const index = top - centerKey;
    const y = index * rowHeight;
    const visible = y >= el.scrollTop && y <= el.scrollTop + el.clientHeight - rowHeight;
    if (!hovering.current || !visible) center();
    // Auto follows the market; hover holds the ladder until the price leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey, rowHeight, settings.dom.follow, top]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onEnter = () => {
    hovering.current = true;
    holdUntil.current = 0;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const onLeave = () => {
    hovering.current = false;
    if (settings.dom.follow === 'fixed') return;
    if (settings.dom.follow === 'timed') {
      holdUntil.current = Date.now() + settings.dom.timedSec * 1_000;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(center, settings.dom.timedSec * 1_000);
      return;
    }
    holdUntil.current = 0;
    center();
  };

  if (keys.length === 0) return <Empty text="Waiting for the book…" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid shrink-0 items-center border-b border-border/60 px-1 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column) => (
          <span
            key={column.id}
            className={column.id === 'price' ? 'text-center' : 'text-right'}
          >
            {COLUMN_LABELS[column.id]}
          </span>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {keys.map((key) => {
          const price = Number((key * step).toPrecision(12));
          const bidSize = bidMap.get(key) ?? 0;
          const askSize = askMap.get(key) ?? 0;
          const side = bestAskKey > 0 && key >= bestAskKey ? 'ask' : bestBidKey > 0 && key <= bestBidKey ? 'bid' : 'spread';
          const traded = totals.get(key) ?? { buy: 0, sell: 0 };
          const delta = traded.buy - traded.sell;
          const last = lastSizes.get(key);
          const resting = side === 'ask' ? askSize : bidSize;
          const threshold = side === 'ask' ? askThreshold : bidThreshold;
          const highlight = resting > 0 && threshold > 0 && resting >= threshold;
          const values: Record<string, { text: string; color?: string }> = {
            sold: {
              text: domSize(traded.sell, settings.dom.unit, price),
              color: settings.dom.askColor,
            },
            bid: { text: domSize(bidSize, settings.dom.unit, price) },
            price: {
              text: formatPrice(price, decimals),
              color: side === 'ask' ? settings.dom.askColor : side === 'bid' ? settings.dom.bidColor : undefined,
            },
            ask: { text: domSize(askSize, settings.dom.unit, price) },
            bought: {
              text: domSize(traded.buy, settings.dom.unit, price),
              color: settings.dom.bidColor,
            },
            delta: (() => {
              const text = domSize(Math.abs(delta), settings.dom.unit, price);
              return {
                text: text ? `${delta > 0 ? '+' : '-'}${text}` : '',
                color:
                  delta > 0
                    ? settings.dom.bidColor
                    : delta < 0
                      ? settings.dom.askColor
                      : undefined,
              };
            })(),
            volume: {
              text: domSize(traded.buy + traded.sell, settings.dom.unit, price),
            },
            last: {
              text: last === undefined ? '' : domSize(last, settings.dom.unit, price),
            },
          };
          return (
            <div
              key={key}
              className="relative grid items-center px-1 font-mono text-[10.5px] tabular-nums"
              style={{ height: rowHeight, gridTemplateColumns: template }}
            >
              {highlight && (
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundColor: side === 'ask' ? settings.dom.askColor : settings.dom.bidColor,
                    opacity: 0.14,
                  }}
                />
              )}
              {columns.map((column) => (
                <span
                  key={column.id}
                  className={
                    column.id === 'price'
                      ? 'relative z-10 text-center text-foreground'
                      : 'relative z-10 truncate text-right text-foreground'
                  }
                  style={values[column.id]?.color ? { color: values[column.id]!.color } : undefined}
                >
                  {values[column.id]?.text ?? ''}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-border/60 px-2 text-[10px] text-muted-foreground">
        <span>Traded since {state.startedAt ? formatSince(state.startedAt) : '—'} UTC</span>
        <div className="flex items-center gap-2">
          {settings.dom.follow === 'fixed' ? (
            <button
              type="button"
              onClick={center}
              className="inline-flex items-center gap-1 rounded px-1 text-[10px] text-foreground hover:bg-accent"
            >
              <Target className="size-3" /> Center
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReset}
            className="rounded px-1 text-[10px] text-foreground hover:bg-accent"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function TradesTab({
  state,
  settings,
  venues,
}: {
  state: OrderFlowState;
  settings: OrderFlowSettings;
  venues: VenueId[];
}) {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<{
    trades: OrderFlowTrade[];
    buy: number;
    sell: number;
  } | null>(null);
  const hoverRef = useRef<{ trades: OrderFlowTrade[]; buy: number; sell: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const raw = state.trades.filter((trade) => venues.includes(trade.venue));
  const cutoff = Date.now() - 60_000;
  let buy = 0;
  let sell = 0;
  for (const trade of raw) {
    if (trade.time < cutoff) continue;
    const notional = trade.price * trade.size;
    if (trade.side === 'buy') buy += notional;
    else sell += notional;
  }
  const filtered = raw.filter((trade) => {
    const notional = trade.price * trade.size;
    if (settings.trades.min !== null && notional < settings.trades.min) return false;
    if (settings.trades.max !== null && notional > settings.trades.max) return false;
    return true;
  });
  const combined = settings.trades.combine
    ? combineFills(filtered)
    : [...filtered].sort((left, right) => right.time - left.time);
  const average = filtered.length
    ? filtered.reduce((sum, trade) => sum + trade.price * trade.size, 0) / filtered.length
    : 0;
  const threshold =
    settings.trades.highlight === 'relative'
      ? average * settings.trades.multiplier
      : settings.trades.amount;
  const frozenRatio = paused
    ? frozen
    : hovering && settings.trades.freeze && hoverRef.current
      ? hoverRef.current
      : null;
  const shownBuy = frozenRatio ? frozenRatio.buy : buy;
  const shownSell = frozenRatio ? frozenRatio.sell : sell;
  const total = shownBuy + shownSell;
  const buyPct = total > 0 ? (shownBuy / total) * 100 : 50;
  const trades = paused
    ? frozen?.trades ?? []
    : hovering && settings.trades.freeze && hoverRef.current
      ? hoverRef.current.trades
      : combined;
  const rowHeight = Math.max(13, Math.round(ROW_BASE * (settings.trades.zoom / 100)));
  const togglePause = () => {
    if (paused) {
      setPaused(false);
      setFrozen(null);
    } else {
      setPaused(true);
      setFrozen({ trades: combined, buy, sell });
    }
  };
  const onEnter = () => {
    if (!settings.trades.freeze) return;
    hoverRef.current = { trades: combined, buy, sell };
    setHovering(true);
  };
  const onLeave = () => {
    hoverRef.current = null;
    setHovering(false);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <button
          type="button"
          onClick={togglePause}
          className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-foreground hover:bg-accent"
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <span className="text-[9.5px] text-muted-foreground">1m</span>
        <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-muted">
          <span
            className="absolute inset-y-0 left-0"
            style={{ width: `${buyPct}%`, backgroundColor: settings.trades.bidColor }}
          />
          <span
            className="absolute inset-y-0 right-0"
            style={{ width: `${100 - buyPct}%`, backgroundColor: settings.trades.askColor }}
          />
        </div>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: settings.trades.bidColor }}>
          {buyPct.toFixed(0)}%
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: settings.trades.askColor }}>
          {(100 - buyPct).toFixed(0)}%
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {currency(total)} {state.quote}
        </span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto font-mono text-[10.5px] tabular-nums"
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {trades.length === 0 ? (
          <Empty text="Waiting for trades…" />
        ) : (
          trades.slice(0, 500).map((trade) => {
            const notional = trade.price * trade.size;
            const large = threshold > 0 && notional >= threshold;
            const color = sideColor(settings.trades, trade.side);
            return (
              <div
                key={`${trade.venue}-${trade.id}-${trade.time}`}
                className="relative grid items-center gap-1 px-2"
                style={{ height: rowHeight, gridTemplateColumns: '1.1fr 1fr auto' }}
              >
                {large ? (
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundColor: color, opacity: 0.16 }}
                  />
                ) : null}
                <span className="relative truncate" style={{ color }}>
                  {formatPrice(trade.price, decimalsForStep(10 ** -state.pricePrecision))}
                </span>
                <span className="relative truncate text-right text-foreground/90">
                  {formatSize(trade.size, settings.trades.unit, trade.price)}
                </span>
                <span className="relative flex items-center justify-end gap-1 text-muted-foreground">
                  <VenueIcon venue={trade.venue} size={11} />
                  <span className="w-[58px] text-right">{formatTradeTime(trade.time, settings.trades.ms)}</span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
      {text}
    </div>
  );
}

function ExchangeMenu({
  state,
  settings,
  onChange,
  chartVenue,
}: {
  state: OrderFlowState;
  settings: OrderFlowSettings;
  onChange: Dispatch<SetStateAction<OrderFlowSettings>>;
  chartVenue: string;
}) {
  const peers = state.peers;
  const current = settings.venues === null ? peers.map((peer) => peer.venue) : settings.venues;
  const all = peers.length > 0 && peers.every((peer) => current.includes(peer.venue));
  const toggleAll = () => {
    onChange((prev) => ({ ...prev, venues: all ? [] : null }));
  };
  const toggle = (venue: VenueId) => {
    const next = new Set(current);
    if (next.has(venue)) next.delete(venue);
    else next.add(venue);
    const values = peers.map((peer) => peer.venue).filter((id) => next.has(id));
    onChange((prev) => ({
      ...prev,
      venues: values.length === peers.length ? null : values,
    }));
  };
  return (
    <div className="space-y-2 p-1">
      <div className="px-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Read the book from
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-foreground hover:bg-accent">
        <input
          type="radio"
          name="orderflow-source"
          checked={settings.source === 'combined'}
          onChange={() => onChange((prev) => ({ ...prev, source: 'combined' }))}
          className="size-3 accent-primary"
        />
        <span className="flex-1">Combined</span>
        {settings.source === 'combined' ? <span className="text-primary">✓</span> : null}
      </label>
      {peers.map((peer) => (
        <label
          key={peer.venue}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-foreground hover:bg-accent"
        >
          <input
            type="radio"
            name="orderflow-source"
            checked={settings.source === peer.venue}
            onChange={() => onChange((prev) => ({ ...prev, source: peer.venue }))}
            className="size-3 accent-primary"
          />
          <VenueIcon venue={peer.venue} size={13} />
          <span className="min-w-0 flex-1 truncate">
            {venueLabel(peer.venue)} · {peer.display}
          </span>
          {peer.venue === chartVenue ? (
            <span className="rounded border border-border px-1 text-[8.5px] uppercase tracking-wide text-muted-foreground">
              Chart
            </span>
          ) : null}
          {state.stale.includes(peer.venue) ? (
            <span className="size-1.5 rounded-full bg-amber-500" title="No fresh book" />
          ) : null}
        </label>
      ))}
      <div className="my-1 border-t border-border/70" />
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Include
        </span>
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
          All
          <input
            type="checkbox"
            checked={all}
            onChange={toggleAll}
            className="size-3 accent-primary"
          />
        </label>
      </div>
      {peers.map((peer) => (
        <label
          key={`include-${peer.venue}`}
          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-foreground hover:bg-accent"
        >
          <input
            type="checkbox"
            checked={current.includes(peer.venue)}
            onChange={() => toggle(peer.venue)}
            className="size-3 accent-primary"
          />
          <VenueIcon venue={peer.venue} size={13} />
          <span className="min-w-0 flex-1 truncate">{venueLabel(peer.venue)}</span>
        </label>
      ))}
      <p className="px-1.5 pt-1 text-[10px] leading-snug text-muted-foreground">
        Sizes at each price are added up across the exchanges. Perpetual and spot books, or USD and
        USDT ones, trade a little apart.
      </p>
    </div>
  );
}

export function OrderFlowPanel({ symbol }: PanelProps) {
  const [preferences, setPreferences] = usePersistedState(
    'screener.orderflow.v2',
    DEFAULT_ORDER_FLOW_PREFERENCES,
    isOrderFlowPreferences,
  );
  const symbolKey = orderFlowSymbolKey(symbol);
  const settings = settingsForSymbol(preferences, symbolKey);
  const setSettings = useCallback<Dispatch<SetStateAction<OrderFlowSettings>>>(
    (action) => {
      setPreferences((prev) => {
        const current = settingsForSymbol(prev, symbolKey);
        const next = typeof action === 'function' ? action(current) : action;
        return {
          ...prev,
          tab: next.tab,
          venues: next.venues,
          symbols: { ...prev.symbols, [symbolKey]: next },
        };
      });
    },
    [setPreferences, symbolKey],
  );
  const hookVenues = settings.source === 'combined' ? settings.venues : [settings.source];
  const { state, dropVenues, resetWindow } = useOrderFlow(
    symbol,
    hookVenues,
    settings.grouping,
  );
  const validSource =
    settings.source === 'combined' || state.peers.some((peer) => peer.venue === settings.source);
  const source = validSource ? settings.source : 'combined';
  useEffect(() => {
    if (state.peers.length === 0) return;
    if (
      settings.source !== 'combined' &&
      !state.peers.some((peer) => peer.venue === settings.source)
    ) {
      setSettings((prev) => ({ ...prev, source: 'combined' }));
    }
  }, [state.peers, settings.source, setSettings]);
  const included =
    source === 'combined'
      ? settings.venues === null
        ? state.peers
        : state.peers.filter((peer) => settings.venues?.includes(peer.venue))
      : state.peers.filter((peer) => peer.venue === source);
  const includedVenues = included.map((peer) => peer.venue);
  const includedKey = includedVenues.join(',');
  const previous = useRef<string[]>([]);
  useEffect(() => {
    if (state.peers.length === 0) return;
    const removed = previous.current.filter((venue) => !includedVenues.includes(venue));
    if (removed.length > 0) dropVenues(removed);
    previous.current = includedVenues;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key identifies the list
  }, [includedKey, state.peers.length, dropVenues]);
  const book = state.book;
  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];
  const lastTrade = state.trades.at(-1)?.price ?? 0;
  const chartVenue = symbol.includes(':')
    ? symbol.slice(0, symbol.indexOf(':')).toLowerCase()
    : 'binance';
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || lastTrade;
  const tick = state.tickSize || 10 ** -state.pricePrecision;
  const auto = autoGrouping(mid, tick);
  const grouping = settings.grouping ?? auto;
  const step = Math.max(grouping, tick);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const activeCount = book?.venues.length ?? 0;
  const live = state.status === 'live' && activeCount > 0;
  const warning = state.warnings.at(-1);
  const options = groupingOptions(mid, tick);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
        <Popover.Root open={exchangeOpen} onOpenChange={setExchangeOpen}>
          <Popover.Trigger
            aria-label="Exchange"
            className="inline-flex h-6 min-w-0 items-center gap-1 rounded border border-border/70 px-1.5 text-[10.5px] text-foreground hover:bg-accent"
          >
            <span
              className={
                live
                  ? 'size-1.5 shrink-0 rounded-full bg-positive'
                  : state.status === 'error'
                    ? 'size-1.5 shrink-0 rounded-full bg-negative'
                    : 'size-1.5 shrink-0 rounded-full bg-amber-500'
              }
            />
            <span className="truncate">
              {included.length > 0
                ? `${included.length} exchange${included.length === 1 ? '' : 's'}`
                : 'No exchanges'}
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Popover.Trigger>
          <PopoverContent className="w-[300px] p-1" align="start">
            <ExchangeMenu
              state={state}
              settings={settings}
              onChange={setSettings}
              chartVenue={chartVenue}
            />
          </PopoverContent>
        </Popover.Root>

        <Popover.Root open={infoOpen} onOpenChange={setInfoOpen}>
          <Popover.Trigger
            aria-label="About this data"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Info className="size-3.5" />
          </Popover.Trigger>
          <PopoverContent className="w-[310px] p-3 text-[10.5px] leading-relaxed text-muted-foreground" align="start">
            <div className="mb-1 text-[11px] font-semibold text-foreground">About this data</div>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>
                Books come from the venues' public feeds, grouped at the price step you pick,
                and merged by the sidecar into one ladder.
              </li>
              <li>
                Binance: each trade is one taker fill; Combine joins same-millisecond fills.
                Coinbase reports the resting side; the panel shows the taker side.
              </li>
              <li>Hyperliquid's public book is 20 levels a side, refreshed every few seconds.</li>
              <li>
                Combined: sizes at each price are added across the included venues; spot/perp and
                USD/USDT books trade a little apart.
              </li>
              <li>Sold, bought, delta and volume count trades since the panel opened or Reset.</li>
            </ul>
          </PopoverContent>
        </Popover.Root>

        <div className="min-w-0 flex-1" />

        <Popover.Root open={groupingOpen} onOpenChange={setGroupingOpen}>
          <Popover.Trigger
            aria-label="Price grouping"
            className="inline-flex h-6 items-center gap-1 rounded border border-border/70 px-1.5 font-mono text-[10.5px] tabular-nums text-foreground hover:bg-accent"
          >
            Group {formatGrouping(step)}
            <ChevronDown className="size-3 text-muted-foreground" />
          </Popover.Trigger>
          <PopoverContent className="w-40 p-1" align="end">
            <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Group prices by
            </div>
            <button
              type="button"
              onClick={() => {
                setSettings((prev) => ({ ...prev, grouping: null }));
                setGroupingOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-1.5 py-1 text-[11px] text-foreground hover:bg-accent"
            >
              <span>Auto</span>
              <span className="font-mono text-[10px] text-muted-foreground">{formatGrouping(auto)}</span>
            </button>
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSettings((prev) => ({ ...prev, grouping: option }));
                  setGroupingOpen(false);
                }}
                className="flex w-full items-center justify-between rounded px-1.5 py-1 font-mono text-[11px] tabular-nums text-foreground hover:bg-accent"
              >
                {formatGrouping(option)}
                {settings.grouping === option ? <span className="text-primary">✓</span> : null}
              </button>
            ))}
          </PopoverContent>
        </Popover.Root>

        <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Popover.Trigger
            aria-label={`${settings.tab} settings`}
            className="inline-flex size-6 items-center justify-center rounded border border-border/70 text-foreground hover:bg-accent"
          >
            <Settings2 className="size-3.5" />
          </Popover.Trigger>
          <PopoverContent className="max-h-[70vh] w-[310px] overflow-y-auto p-3" align="end">
            <SettingsBody
              tab={settings.tab}
              settings={settings}
              state={state}
              onChange={setSettings}
            />
          </PopoverContent>
        </Popover.Root>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1.5">
        <Segmented
          value={settings.tab}
          onChange={(tab: OrderFlowTab) => setSettings((prev) => ({ ...prev, tab }))}
          options={TABS}
        />
        {state.kind === 'spot' ? (
          <span className="rounded border border-border px-1 text-[8.5px] uppercase tracking-wide text-muted-foreground">
            Spot
          </span>
        ) : null}
        <div className="min-w-0 flex-1" />
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {state.base && state.quote ? `${state.base}/${state.quote}` : ''}
        </span>
      </div>

      {warning ? (
        <div className="shrink-0 border-b border-border/60 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600">
          {warning.venue ? `${venueLabel(warning.venue)}: ` : ''}
          {warning.message}
        </div>
      ) : null}

      {!symbol ? (
        <Empty text="Select a chart to read its order flow." />
      ) : state.status === 'error' ? (
        <Empty text={state.error ?? 'No order-flow feed for this symbol.'} />
      ) : included.length === 0 ? (
        <Empty text="No venues selected. Choose at least one in the Exchange menu." />
      ) : !state.book || (state.book.bids.length === 0 && state.book.asks.length === 0) ? (
        <Empty text="Connecting to the venue feeds…" />
      ) : settings.tab === 'book' ? (
        <BookTab state={state} settings={settings} book={state.book} step={step} />
      ) : settings.tab === 'dom' ? (
        <DomTab
          state={state}
          settings={settings}
          book={state.book}
          venues={includedVenues}
          step={step}
          onReset={resetWindow}
        />
      ) : (
        <TradesTab state={state} settings={settings} venues={includedVenues} />
      )}
    </div>
  );
}
