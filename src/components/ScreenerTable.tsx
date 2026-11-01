import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '@base-ui/react';
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  ExternalLink,
  Search,
  Star,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  ColumnState,
  MarketRow,
  PlotColumn,
  ScanResult,
  ScreenerView,
  SortState,
} from '../types';
import {
  formatCompact,
  formatFunding,
  formatNextFunding,
  formatNumber,
  formatPct,
  formatPrice,
} from '../lib/format';
import { cn } from '../ui/cn';
import { IconButton, Input, Segmented } from '../ui/primitives';
import { PopoverContent } from '../ui/overlays';

type ColumnKind = 'symbol' | 'price' | 'change' | 'volume' | 'funding' | 'plot';

interface ColumnDef {
  key: string;
  label: string;
  align: 'left' | 'right';
  kind: ColumnKind;
  width: number;
  plotKey?: string;
}

const BASE_COLUMNS: ColumnDef[] = [
  { key: 'symbol', label: 'Symbol', align: 'left', kind: 'symbol', width: 120 },
  { key: 'price', label: 'Last', align: 'right', kind: 'price', width: 78 },
  { key: 'change24h', label: '24h %', align: 'right', kind: 'change', width: 66 },
  { key: 'quoteVolume', label: 'Vol 24h', align: 'right', kind: 'volume', width: 68 },
  { key: 'funding', label: 'Funding', align: 'right', kind: 'funding', width: 76 },
];

const BASE_KEYS = BASE_COLUMNS.map((column) => column.key);
const MIN_COLUMN_WIDTH = 48;

function scanValue(result: ScanResult | undefined, plotKey: string | undefined): number | null {
  if (!result || !plotKey) return null;
  const plot = result.plots.find((item) => item.key === plotKey);
  return plot?.value ?? null;
}

interface Props {
  rows: MarketRow[];
  view: ScreenerView;
  onViewChange: (view: ScreenerView) => void;
  selectedSymbol: string;
  openSymbols: string[];
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  scanResults: Map<string, ScanResult>;
  plotColumns: PlotColumn[];
  loading: boolean;
  error: string | null;
  onSelect: (symbol: string) => void;
  onOpenTab: (symbol: string) => void;
  onCloseTab: (symbol: string) => void;
}

export function ScreenerTable({
  rows,
  view,
  onViewChange,
  selectedSymbol,
  openSymbols,
  favorites,
  onToggleFavorite,
  scanResults,
  plotColumns,
  loading,
  error,
  onSelect,
  onOpenTab,
  onCloseTab,
}: Props) {
  const { sort, columns, query, filter } = view;
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; symbol: string } | null>(null);
  const colRefs = useRef(new Map<string, HTMLTableColElement>());
  const resizeRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);

  const columnDefs = useMemo<ColumnDef[]>(() => {
    const plots: ColumnDef[] = plotColumns.map((plot) => ({
      key: plot.key,
      label: plot.title,
      align: 'right',
      kind: 'plot',
      width: 76,
      plotKey: plot.plotKey,
    }));
    return [...BASE_COLUMNS, ...plots];
  }, [plotColumns]);

  const columnByKey = useMemo(
    () => new Map(columnDefs.map((column) => [column.key, column])),
    [columnDefs],
  );
  const allKeys = useMemo(() => columnDefs.map((column) => column.key), [columnDefs]);

  const order = useMemo(
    () => [...columns.order, ...allKeys.filter((key) => !columns.order.includes(key))],
    [columns.order, allKeys],
  );
  const visibleColumns = useMemo(
    () =>
      order
        .filter((key) => columnByKey.has(key) && !columns.hidden.includes(key))
        .map((key) => columnByKey.get(key)!),
    [order, columns.hidden, columnByKey],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    let list = rows;
    if (filter === 'gainers') list = list.filter((row) => (row.change24h ?? 0) > 0);
    if (filter === 'losers') list = list.filter((row) => (row.change24h ?? 0) < 0);
    if (filter === 'favorites') list = list.filter((row) => favoriteSet.has(row.symbol));
    if (needle) {
      list = list.filter(
        (row) => row.symbol.includes(needle) || row.base.includes(needle),
      );
    }
    return list;
  }, [rows, query, filter, favoriteSet]);

  const sortedRows = useMemo(() => {
    const value = (row: MarketRow): string | number | null => {
      switch (sort.key) {
        case 'symbol':
          return row.symbol;
        case 'price':
          return row.price;
        case 'change24h':
          return row.change24h;
        case 'quoteVolume':
          return row.quoteVolume;
        case 'funding':
          return row.funding;
        default: {
          const column = columnByKey.get(sort.key);
          if (column?.kind !== 'plot') return null;
          return scanValue(scanResults.get(row.symbol), column.plotKey);
        }
      }
    };
    return [...filteredRows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left ?? '').localeCompare(String(right ?? '')) * sort.dir;
      }
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return (left - right) * sort.dir;
    });
  }, [filteredRows, sort, scanResults, columnByKey]);

  const setView = (patch: Partial<ScreenerView>) => onViewChange({ ...view, ...patch });
  const setSort = (sort: SortState) => setView({ sort });
  const setColumns = (columns: ColumnState) => setView({ columns });

  const toggleSort = (key: string) => {
    const numeric = key !== 'symbol';
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 1 ? -1 : 1 }
        : { key, dir: numeric ? -1 : 1 },
    );
  };

  const toggleColumn = (key: string) => {
    const hidden = columns.hidden.includes(key)
      ? columns.hidden.filter((item) => item !== key)
      : [...columns.hidden, key];
    if (visibleColumns.length <= 1 && !columns.hidden.includes(key)) return;
    setColumns({ ...columns, hidden });
  };

  const moveColumn = (key: string, delta: -1 | 1) => {
    const keys = [...order];
    const index = keys.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    setColumns({ ...columns, order: keys });
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    const cell = event.currentTarget.parentElement;
    if (!cell) return;
    const startWidth = Math.round(cell.getBoundingClientRect().width);
    resizeRef.current = { key, startX: event.clientX, startWidth, width: startWidth };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    resize.width = Math.max(
      MIN_COLUMN_WIDTH,
      Math.round(resize.startWidth + event.clientX - resize.startX),
    );
    const col = colRefs.current.get(resize.key);
    if (col) col.style.width = `${resize.width}px`;
  };

  const endResize = () => {
    const resize = resizeRef.current;
    if (!resize) return;
    resizeRef.current = null;
    setColumns({
      ...columns,
      widths: { ...columns.widths, [resize.key]: resize.width },
    });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const headerCell = (column: ColumnDef) => (
    <th
      key={column.key}
      onClick={() => toggleSort(column.key)}
      className={cn(
        'group/head relative sticky top-0 z-10 h-7 cursor-pointer select-none whitespace-nowrap border-b border-border bg-card px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
        column.align === 'right' ? 'text-right' : 'text-left',
        column.kind === 'symbol' && 'sticky left-0 z-20 border-r border-border/70',
        sort.key === column.key && 'text-foreground',
      )}
    >
      <span className="inline-flex items-center gap-1">
        {column.label}
        {sort.key === column.key ? (
          sort.dir === 1 ? (
            <ArrowUp className="size-2.5" />
          ) : (
            <ArrowDown className="size-2.5" />
          )
        ) : null}
      </span>
      <div
        onPointerDown={(event) => startResize(event, column.key)}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onClick={(event) => event.stopPropagation()}
        title="Drag to resize"
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40"
      />
    </th>
  );

  const cell = (column: ColumnDef, row: MarketRow, selected: boolean) => {
    switch (column.kind) {
      case 'symbol':
        return (
          <td
            key={column.key}
            title={row.symbol}
            className={cn(
              'sticky left-0 z-10 h-7 whitespace-nowrap border-r border-border/70 px-2',
              selected ? 'bg-primary-soft' : 'bg-card group-hover:bg-accent',
            )}
          >
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(row.symbol);
                }}
                title={
                  favoriteSet.has(row.symbol)
                    ? `Remove ${row.symbol} from favorites`
                    : `Add ${row.symbol} to favorites`
                }
                aria-label={
                  favoriteSet.has(row.symbol)
                    ? `Remove ${row.symbol} from favorites`
                    : `Add ${row.symbol} to favorites`
                }
                className={cn(
                  'inline-flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent',
                  favoriteSet.has(row.symbol)
                    ? 'text-amber-400'
                    : 'text-muted-foreground/45 hover:text-amber-300',
                )}
              >
                <Star
                  className={cn(
                    'size-3',
                    favoriteSet.has(row.symbol) && 'fill-current',
                  )}
                />
              </button>
              <span className="min-w-0 truncate text-[11px] font-semibold text-foreground">
                {row.base}
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60">
                perp
              </span>
              {scanResults.get(row.symbol)?.error ? (
                <span
                  className="size-1.5 rounded-full bg-negative"
                  title={scanResults.get(row.symbol)?.error}
                />
              ) : null}
            </div>
          </td>
        );
      case 'price':
        return (
          <td
            key={column.key}
            className="h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums text-foreground/90"
          >
            {formatPrice(row.price, row.pricePrecision)}
          </td>
        );
      case 'change':
        return (
          <td
            key={column.key}
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              (row.change24h ?? 0) >= 0 ? 'text-positive' : 'text-negative',
            )}
          >
            {formatPct(row.change24h)}
          </td>
        );
      case 'volume':
        return (
          <td
            key={column.key}
            className="h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {formatCompact(row.quoteVolume)}
          </td>
        );
      case 'funding':
        return (
          <td
            key={column.key}
            title={formatNextFunding(row.nextFunding)}
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              (row.funding ?? 0) >= 0 ? 'text-positive' : 'text-negative',
            )}
          >
            {formatFunding(row.funding)}
          </td>
        );
      case 'plot': {
        const value = scanValue(scanResults.get(row.symbol), column.plotKey);
        const signal = value === 1 ? 'positive' : value === 0 ? 'muted' : 'neutral';
        return (
          <td
            key={column.key}
            title={column.label}
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              signal === 'positive' && 'text-positive',
              signal === 'muted' && 'text-muted-foreground',
              signal === 'neutral' && 'text-foreground/80',
            )}
          >
            {value === 1 ? '●' : value === 0 ? '·' : formatNumber(value)}
          </td>
        );
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-2">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setView({ query: event.target.value })}
              placeholder="Search symbol…"
              className="pl-7 pr-7"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setView({ query: '' })}
                title="Clear search"
                className="absolute right-1 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
          <Popover.Root open={columnsOpen} onOpenChange={setColumnsOpen}>
            <Popover.Trigger
              title="Columns"
              aria-label="Columns"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Columns3 className="size-3.5" />
            </Popover.Trigger>
            <PopoverContent className="w-60 p-1.5" align="end">
              <div className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Columns
              </div>
              <div className="max-h-72 overflow-y-auto">
                {order.map((key, index) => {
                  const def = columnByKey.get(key);
                  if (!def) return null;
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12px] text-foreground">
                        <input
                          type="checkbox"
                          checked={!columns.hidden.includes(key)}
                          onChange={() => toggleColumn(key)}
                          className="size-3 accent-primary"
                        />
                        <span className="truncate">{def.label}</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => moveColumn(key, -1)}
                        disabled={index === 0}
                        title="Move up"
                        className="px-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-25"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumn(key, 1)}
                        disabled={index === order.length - 1}
                        title="Move down"
                        className="px-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-25"
                      >
                        ▼
                      </button>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover.Root>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Segmented
            value={filter}
            onChange={(filter) => setView({ filter })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'gainers', label: 'Gainers' },
              { value: 'losers', label: 'Losers' },
              { value: 'favorites', label: 'Favorites' },
            ]}
          />
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {sortedRows.length}
            {rows.length !== sortedRows.length ? ` / ${rows.length}` : ''}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full table-fixed border-collapse text-[12px]"
          style={{
            minWidth: visibleColumns.reduce(
              (sum, column) => sum + (columns.widths[column.key] ?? column.width),
              0,
            ),
          }}
        >
          <colgroup>
            {visibleColumns.map((column) => (
              <col
                key={column.key}
                ref={(element) => {
                  if (element) colRefs.current.set(column.key, element);
                  else colRefs.current.delete(column.key);
                }}
                style={{
                  width: `${columns.widths[column.key] ?? column.width}px`,
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>{visibleColumns.map(headerCell)}</tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const selected = row.symbol === selectedSymbol;
              return (
                <tr
                  key={row.symbol}
                  onClick={() => onSelect(row.symbol)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, symbol: row.symbol });
                  }}
                  className={cn(
                    'group h-7 cursor-pointer border-b border-border/45 transition-colors',
                    selected ? 'bg-primary-soft' : 'hover:bg-accent/70',
                  )}
                >
                  {visibleColumns.map((column) => cell(column, row, selected))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {sortedRows.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
            {filter === 'favorites' ? (
              <Star className="size-5 opacity-40" />
            ) : (
              <Search className="size-5 opacity-40" />
            )}
            <span className="text-[12px]">
              {loading
                ? 'Loading Binance markets…'
                : error
                  ? 'Market data unavailable'
                  : filter === 'favorites'
                    ? favorites.length === 0
                      ? 'No favorites yet. Click the star next to a symbol.'
                      : 'No favorites match your search.'
                    : 'No markets found'}
            </span>
            {error ? (
              <span className="max-w-60 text-center text-[10px] text-negative/80">{error}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {menu
        ? createPortal(
            <div
              className="fixed z-[70] w-48 rounded-lg border border-border bg-popover p-1 text-[12px] shadow-2xl"
              style={{
                left: Math.min(menu.x, window.innerWidth - 200),
                top: Math.min(menu.y, window.innerHeight - 140),
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  onOpenTab(menu.symbol);
                  setMenu(null);
                }}
              >
                <ExternalLink className="size-3.5 text-muted-foreground" />
                Open in new workspace
              </button>
              {openSymbols.includes(menu.symbol) ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    onCloseTab(menu.symbol);
                    setMenu(null);
                  }}
                >
                  <X className="size-3.5 text-muted-foreground" />
                  Close workspace with this symbol
                </button>
              ) : null}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  void navigator.clipboard?.writeText(menu.symbol);
                  toast.success(`Copied ${menu.symbol}`);
                  setMenu(null);
                }}
              >
                <Copy className="size-3.5 text-muted-foreground" />
                Copy symbol
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
