import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '@base-ui/react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Columns3,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  Filter,
  Globe,
  Lock,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  ColumnState,
  PlotColumn,
  QuickFilter,
  ScanResult,
  ScreenerRow,
  ScreenerView,
  SortState,
  VenueId,
} from '../types';
import {
  formatCompact,
  formatFunding,
  formatNextFunding,
  formatNumber,
  formatPct,
  formatPrice,
} from '../lib/format';
import { DEFAULT_FAVORITE_LIST_ID, type FavoriteList } from '../lib/favorites';
import { activeQuickFilters, filterScreenerRows } from '../lib/screenerFilter';
import { mergeColumnOrder, nextSort } from '../lib/view';
import { cn } from '../ui/cn';
import { Button, Input } from '../ui/primitives';
import { Modal, PopoverContent } from '../ui/overlays';
import { sameVelaSymbol } from '../venues/instrument';
import { VENUE_CATALOG, VENUE_IDS, venueLabel } from '../venues/catalog';
import { VenueIcon } from '../venues/venueIcons';

type ColumnKind =
  | 'symbol'
  | 'venue'
  | 'price'
  | 'change'
  | 'volume'
  | 'funding'
  | 'range'
  | 'volumeChange'
  | 'rvol'
  | 'vwap'
  | 'rsi'
  | 'plot';

interface ColumnDef {
  key: string;
  label: string;
  align: 'left' | 'right';
  kind: ColumnKind;
  width: number;
  plotKey?: string;
}

const BASE_COLUMNS: ColumnDef[] = [
  { key: 'venue', label: 'Venue', align: 'left', kind: 'venue', width: 48 },
  { key: 'symbol', label: 'Symbol', align: 'left', kind: 'symbol', width: 140 },
  { key: 'price', label: 'Last', align: 'right', kind: 'price', width: 76 },
  { key: 'change24h', label: '24h %', align: 'right', kind: 'change', width: 64 },
  { key: 'range', label: 'Range 24h', align: 'right', kind: 'range', width: 76 },
  { key: 'quoteVolume', label: 'Vol 24h', align: 'right', kind: 'volume', width: 68 },
  { key: 'volumeChange', label: 'VolΔ24h', align: 'right', kind: 'volumeChange', width: 76 },
  { key: 'rvol', label: 'RVOL', align: 'right', kind: 'rvol', width: 64 },
  { key: 'funding', label: 'Funding', align: 'right', kind: 'funding', width: 74 },
  { key: 'vwap', label: 'VWAPσ', align: 'right', kind: 'vwap', width: 70 },
  { key: 'rsi', label: 'RSI', align: 'right', kind: 'rsi', width: 56 },
];

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'rsiLow', label: 'RSI <30' },
  { key: 'rsiHigh', label: 'RSI >70' },
  { key: 'rvol', label: 'RVOL ≥1.5' },
  { key: 'aboveVwap', label: '> VWAP' },
  { key: 'belowVwap', label: '< VWAP' },
];

/** Opposite filters replace each other instead of yielding no rows. */
const FILTER_OPPOSITE: Partial<Record<QuickFilter, QuickFilter>> = {
  gainers: 'losers',
  losers: 'gainers',
  rsiLow: 'rsiHigh',
  rsiHigh: 'rsiLow',
  aboveVwap: 'belowVwap',
  belowVwap: 'aboveVwap',
};

const MIN_COLUMN_WIDTH = 48;

function scanValue(result: ScanResult | undefined, plotKey: string | undefined): number | null {
  if (!result || !plotKey) return null;
  const plot = result.plots.find((item) => item.key === plotKey);
  return plot?.value ?? null;
}

function timeframeLabel(timeframe: string): string {
  return timeframe === '60' ? '1h' : `${timeframe}m`;
}

interface Props {
  rows: ScreenerRow[];
  metricsConfig: { timeframe: string; rvolDays: number };
  view: ScreenerView;
  onViewChange: (view: ScreenerView) => void;
  venues: VenueId[];
  onVenuesChange: (venues: VenueId[]) => void;
  venueErrors: Record<string, string>;
  selectedSymbol: string;
  openSymbols: string[];
  favorites: string[];
  favoriteLists: FavoriteList[];
  activeFavoriteListId: string;
  activeFavoriteListName: string;
  onSelectFavoriteList: (id: string) => void;
  onCreateFavoriteList: (name: string) => void;
  onRenameFavoriteList: (id: string, name: string) => void;
  onClearFavoriteList: (id: string) => void;
  onDeleteFavoriteList: (id: string) => void;
  onImportFavorites: (file: File) => void;
  onExportFavorites: () => void;
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
  metricsConfig,
  view,
  onViewChange,
  venues,
  onVenuesChange,
  venueErrors,
  selectedSymbol,
  openSymbols,
  favorites,
  favoriteLists,
  activeFavoriteListId,
  activeFavoriteListName,
  onSelectFavoriteList,
  onCreateFavoriteList,
  onRenameFavoriteList,
  onClearFavoriteList,
  onDeleteFavoriteList,
  onImportFavorites,
  onExportFavorites,
  onToggleFavorite,
  scanResults,
  plotColumns,
  loading,
  error,
  onSelect,
  onOpenTab,
  onCloseTab,
}: Props) {
  const { sort, columns, query } = view;
  const favoritesOnly = view.favoritesOnly === true || view.filter === 'favorites';
  const filters = activeQuickFilters(view);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [venuesOpen, setVenuesOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [listDialog, setListDialog] = useState<{
    mode: 'create' | 'rename';
    name: string;
    error?: string;
  } | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
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
    const base = BASE_COLUMNS.map((column) => {
      if (column.key === 'rvol') {
        return { ...column, label: `RVOL ${metricsConfig.rvolDays}d` };
      }
      if (column.key === 'rsi') {
        return { ...column, label: `RSI ${timeframeLabel(metricsConfig.timeframe)}` };
      }
      return column;
    });
    return [...base, ...plots];
  }, [plotColumns, metricsConfig.rvolDays, metricsConfig.timeframe]);

  const columnByKey = useMemo(
    () => new Map(columnDefs.map((column) => [column.key, column])),
    [columnDefs],
  );
  const allKeys = useMemo(() => columnDefs.map((column) => column.key), [columnDefs]);

  const order = useMemo(
    () => mergeColumnOrder(columns.order, allKeys).filter((key) => key !== 'venue'),
    [columns.order, allKeys],
  );
  const visibleColumns = useMemo(() => {
    const venue = columnByKey.get('venue');
    const symbol = columnByKey.get('symbol');
    const rest = order
      .filter((key) => columnByKey.has(key) && !columns.hidden.includes(key))
      .map((key) => columnByKey.get(key)!)
      .filter((column) => column.kind !== 'symbol');
    return [venue, symbol, ...rest].filter(
      (column): column is ColumnDef => column !== undefined,
    );
  }, [order, columns.hidden, columnByKey]);

  const widthOf = (column: ColumnDef) =>
    column.kind === 'venue'
      ? column.width
      : (columns.widths[column.key] ?? column.width);

  const filteredRows = useMemo(
    () => filterScreenerRows(rows, view, favoriteSet),
    [rows, view, favoriteSet],
  );

  const sortedRows = useMemo(() => {
    const activeSort = sort;
    if (!activeSort) return filteredRows;
    const value = (row: ScreenerRow): string | number | null => {
      switch (activeSort.key) {
        case 'symbol':
          return row.instrument.nativeId;
        case 'venue':
          return venueLabel(row.instrument.venue);
        case 'price':
          return row.price;
        case 'change24h':
          return row.change24h;
        case 'quoteVolume':
          return row.quoteVolume;
        case 'funding':
          return row.funding;
        case 'range':
          return row.metrics.sessionRangePct;
        case 'volumeChange':
          return row.metrics.volumeChange24hPct;
        case 'rvol':
          return row.metrics.rvol;
        case 'vwap':
          return row.metrics.vwapZ;
        case 'rsi':
          return row.metrics.rsi;
        default: {
          const column = columnByKey.get(activeSort.key);
          if (column?.kind !== 'plot') return null;
          return scanValue(scanResults.get(row.instrument.key), column.plotKey);
        }
      }
    };
    return [...filteredRows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left ?? '').localeCompare(String(right ?? '')) * activeSort.dir;
      }
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return (left - right) * activeSort.dir;
    });
  }, [filteredRows, sort, scanResults, columnByKey]);

  const setView = (patch: Partial<ScreenerView>) => onViewChange({ ...view, ...patch });
  const setSort = (sort: SortState | null) => setView({ sort });
  const setColumns = (columns: ColumnState) => setView({ columns });

  const toggleFilter = (key: QuickFilter) => {
    const active = filters.includes(key);
    const opposite = FILTER_OPPOSITE[key];
    const rest = filters.filter((filter) => filter !== key && filter !== opposite);
    setView({ filters: active ? rest : [...rest, key], filter: 'all' });
  };

  const toggleSort = (key: string) => setSort(nextSort(sort, key));

  const toggleColumn = (key: string) => {
    const hidden = columns.hidden.includes(key)
      ? columns.hidden.filter((item) => item !== key)
      : [...columns.hidden, key];
    const visibleData = visibleColumns.filter(
      (column) => column.kind !== 'venue',
    ).length;
    if (visibleData <= 1 && !columns.hidden.includes(key)) return;
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

  const toggleVenue = (id: VenueId) => {
    const selected = new Set(venues);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onVenuesChange(VENUE_IDS.filter((venue) => selected.has(venue)));
  };

  const allVenues = venues.length === VENUE_IDS.length;
  const activeIsDefault = activeFavoriteListId === DEFAULT_FAVORITE_LIST_ID;

  const openFavoriteDialog = (mode: 'create' | 'rename') => {
    setFavoritesOpen(false);
    setListDialog({
      mode,
      name: mode === 'rename' ? activeFavoriteListName : '',
    });
  };

  const submitFavoriteDialog = () => {
    if (!listDialog) return;
    const name = listDialog.name.trim();
    if (!name) {
      setListDialog({ ...listDialog, error: 'Enter a list name' });
      return;
    }
    const duplicate = favoriteLists.some(
      (list) =>
        list.id !== (listDialog.mode === 'rename' ? activeFavoriteListId : '') &&
        list.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      setListDialog({ ...listDialog, error: 'That name is already used' });
      return;
    }
    if (listDialog.mode === 'create') onCreateFavoriteList(name);
    else onRenameFavoriteList(activeFavoriteListId, name);
    setListDialog(null);
  };

  const deleteActiveFavoriteList = () => {
    if (activeIsDefault || !window.confirm(`Delete "${activeFavoriteListName}"?`)) {
      return;
    }
    onDeleteFavoriteList(activeFavoriteListId);
    setFavoritesOpen(false);
  };

  const clearActiveFavoriteList = () => {
    if (
      favorites.length === 0 ||
      !window.confirm(`Clear "${activeFavoriteListName}"?`)
    ) {
      return;
    }
    onClearFavoriteList(activeFavoriteListId);
    setFavoritesOpen(false);
  };

  const isOpen = (symbol: string) =>
    openSymbols.some((candidate) => sameVelaSymbol(candidate, symbol));

  const headerCell = (column: ColumnDef) => {
    const isVenue = column.kind === 'venue';
    const sortIcon =
      sort?.key === column.key ? (
        sort.dir === 1 ? (
          <ArrowUp className="size-2.5" />
        ) : (
          <ArrowDown className="size-2.5" />
        )
      ) : null;
    return (
      <th
        key={column.key}
        onClick={() => toggleSort(column.key)}
        aria-label={isVenue ? 'Venue' : undefined}
        title={isVenue ? 'Sort by venue' : undefined}
        className={cn(
          'group/head relative sticky top-0 z-10 h-7 cursor-pointer select-none whitespace-nowrap border-b border-border bg-card px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
          column.align === 'right' ? 'text-right' : 'text-left',
          column.kind === 'symbol' && 'sticky left-0 z-20 border-r border-border/70',
          sort?.key === column.key && 'text-foreground',
        )}
      >
        {isVenue ? (
          <span className="flex items-center justify-center gap-1">
            <Globe className="size-3 text-muted-foreground/70" />
            {sortIcon ?? <ArrowUpDown className="size-2.5 opacity-50" />}
          </span>
        ) : column.kind === 'symbol' ? (
          <span className="flex select-text items-center gap-1 normal-case tracking-normal">
            <Search className="size-3 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setView({ query: event.target.value })}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              placeholder="Search"
              aria-label="Search symbol or venue"
              className="h-5 min-w-0 flex-1 cursor-text bg-transparent text-[11px] font-normal text-foreground outline-none placeholder:text-muted-foreground/80"
            />
            {query ? (
              <button
                type="button"
                title="Clear search"
                aria-label="Clear search"
                onClick={(event) => {
                  event.stopPropagation();
                  setView({ query: '' });
                }}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            ) : (
              (sortIcon ?? <ArrowUpDown className="size-2.5 shrink-0 opacity-40" />)
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            {column.label}
            {sortIcon}
          </span>
        )}
        {isVenue ? null : (
          <div
            onPointerDown={(event) => startResize(event, column.key)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onClick={(event) => event.stopPropagation()}
            title="Drag to resize"
            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40"
          />
        )}
      </th>
    );
  };

  const cell = (column: ColumnDef, row: ScreenerRow, selected: boolean) => {
    const instrument = row.instrument;
    switch (column.kind) {
      case 'symbol':
        return (
          <td
            key={column.key}
            title={instrument.velaSymbol}
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
                  onToggleFavorite(instrument.key);
                }}
                title={
                  favoriteSet.has(instrument.key)
                    ? `Remove ${instrument.display} from ${activeFavoriteListName}`
                    : `Add ${instrument.display} to ${activeFavoriteListName}`
                }
                aria-label={
                  favoriteSet.has(instrument.key)
                    ? `Remove ${instrument.display} from ${activeFavoriteListName}`
                    : `Add ${instrument.display} to ${activeFavoriteListName}`
                }
                className={cn(
                  'inline-flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent',
                  favoriteSet.has(instrument.key)
                    ? 'text-amber-400'
                    : 'text-muted-foreground/45 hover:text-amber-300',
                )}
              >
                <Star
                  className={cn(
                    'size-3',
                    favoriteSet.has(instrument.key) && 'fill-current',
                  )}
                />
              </button>
              <span className="min-w-0 truncate text-[11px] font-semibold text-foreground">
                {instrument.base}
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {instrument.kind}
              </span>
              {scanResults.get(instrument.key)?.error ? (
                <span
                  className="size-1.5 rounded-full bg-negative"
                  title={scanResults.get(instrument.key)?.error}
                />
              ) : null}
            </div>
          </td>
        );
      case 'venue': {
        const label = venueLabel(instrument.venue);
        return (
          <td
            key={column.key}
            title={label}
            className="h-7 px-0 text-center"
          >
            <div className="flex items-center justify-center">
              <VenueIcon venue={instrument.venue} size={14} />
            </div>
          </td>
        );
      }
      case 'price':
        return (
          <td
            key={column.key}
            className="h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums text-foreground/90"
          >
            {formatPrice(row.price, instrument.pricePrecision)}
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
      case 'range':
        return (
          <td
            key={column.key}
            title="Price position inside the UTC session range"
            className="h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums text-foreground/80"
          >
            {row.metrics.sessionRangePct === null
              ? '-'
              : `${row.metrics.sessionRangePct.toFixed(2)}%`}
          </td>
        );
      case 'volumeChange': {
        const value = row.metrics.volumeChange24hPct;
        return (
          <td
            key={column.key}
            title="Current 24h volume against the previous 24h"
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              (value ?? 0) >= 0 ? 'text-positive' : 'text-negative',
            )}
          >
            {formatPct(value)}
          </td>
        );
      }
      case 'rvol':
        return (
          <td
            key={column.key}
            title={`Volume against the ${metricsConfig.rvolDays}-day average`}
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              (row.metrics.rvol ?? 0) >= 1.5 ? 'text-positive' : 'text-muted-foreground',
            )}
          >
            {row.metrics.rvol === null ? '-' : row.metrics.rvol.toFixed(2)}
          </td>
        );
      case 'vwap':
        return (
          <td
            key={column.key}
            title="Session VWAP z-score"
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              (row.metrics.vwapZ ?? 0) >= 0 ? 'text-positive/90' : 'text-negative/90',
            )}
          >
            {row.metrics.vwapZ === null
              ? '-'
              : `${row.metrics.vwapZ >= 0 ? '+' : ''}${row.metrics.vwapZ.toFixed(2)}`}
          </td>
        );
      case 'rsi': {
        const value = row.metrics.rsi;
        return (
          <td
            key={column.key}
            title={`Wilder RSI ${timeframeLabel(metricsConfig.timeframe)}`}
            className={cn(
              'h-7 whitespace-nowrap px-2 text-right font-mono text-[11px] tabular-nums',
              value === null
                ? 'text-muted-foreground'
                : value < 30
                  ? 'text-positive'
                  : value > 70
                    ? 'text-negative'
                    : 'text-foreground/80',
            )}
          >
            {value === null ? '-' : value.toFixed(1)}
          </td>
        );
      }
      case 'plot': {
        const value = scanValue(scanResults.get(instrument.key), column.plotKey);
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
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={favoritesOnly}
            title={`Show only ${activeFavoriteListName}`}
            onClick={() =>
              setView({
                favoritesOnly: !favoritesOnly,
                filter: 'all',
              })
            }
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors',
              favoritesOnly
                ? 'border-primary/60 bg-primary-soft'
                : 'border-border hover:bg-accent',
            )}
          >
            <span
              className={cn(
                favoritesOnly ? 'text-muted-foreground' : 'font-medium text-foreground',
              )}
            >
              All
            </span>
            <span
              className={cn(
                'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
                favoritesOnly ? 'border-primary bg-primary' : 'border-border bg-muted/70',
              )}
            >
              <span
                className={cn(
                  'inline-block size-3 rounded-full shadow-sm transition-transform',
                  favoritesOnly
                    ? 'translate-x-3.5 bg-primary-foreground'
                    : 'translate-x-0.5 bg-foreground/60',
                )}
              />
            </span>
            <span
              className={cn(
                favoritesOnly ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              Favorites
            </span>
          </button>
          <Popover.Root open={favoritesOpen} onOpenChange={setFavoritesOpen}>
            <Popover.Trigger
              title={`Favorites: ${activeFavoriteListName}`}
              aria-label={`Favorites lists: ${activeFavoriteListName}`}
              className="inline-flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Star
                className={cn(
                  'size-3.5 shrink-0',
                  favorites.length > 0 && 'fill-current text-amber-400',
                )}
              />
              <span className="min-w-0 truncate font-medium text-foreground">
                {activeFavoriteListName}
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </Popover.Trigger>
            <PopoverContent className="w-64 p-1" align="start">
              <div className="flex items-center justify-between px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Favorites</span>
                <span className="font-mono tabular-nums">{favoriteLists.length}</span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {favoriteLists.map((list) => {
                  const active = list.id === activeFavoriteListId;
                  return (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => {
                        onSelectFavoriteList(list.id);
                        setFavoritesOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px]',
                        active
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{list.name}</span>
                      {list.id === DEFAULT_FAVORITE_LIST_ID ? (
                        <Lock
                          className="size-3 shrink-0 text-muted-foreground/60"
                          aria-label="Default list"
                        />
                      ) : null}
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {list.items.length}
                      </span>
                      {active ? (
                        <Check className="size-3 shrink-0 text-primary" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="my-1 border-t border-border/70" />
              <button
                type="button"
                onClick={() => openFavoriteDialog('create')}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
                New list…
              </button>
              <button
                type="button"
                onClick={() => openFavoriteDialog('rename')}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-3.5" />
                Rename…
              </button>
              <button
                type="button"
                onClick={clearActiveFavoriteList}
                disabled={favorites.length === 0}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eraser className="size-3.5" />
                Clear list…
              </button>
              <button
                type="button"
                onClick={deleteActiveFavoriteList}
                disabled={activeIsDefault}
                title={
                  activeIsDefault ? 'The default list cannot be deleted' : undefined
                }
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
              <div className="my-1 border-t border-border/70" />
              <button
                type="button"
                onClick={() => {
                  setFavoritesOpen(false);
                  importRef.current?.click();
                }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Upload className="size-3.5" />
                Import…
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportFavorites();
                  setFavoritesOpen(false);
                }}
                disabled={favoriteLists.every((list) => list.items.length === 0)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="size-3.5" />
                Export…
              </button>
            </PopoverContent>
          </Popover.Root>
          <input
            ref={importRef}
            type="file"
            accept=".json,.txt,.csv,application/json,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFavorites(file);
              event.currentTarget.value = '';
            }}
          />
          <Popover.Root open={venuesOpen} onOpenChange={setVenuesOpen}>
            <Popover.Trigger
              title={`Filter venues (${venues.length}/${VENUE_IDS.length})`}
              aria-label="Filter venues"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Filter className="size-3" />
              Venues
            </Popover.Trigger>
            <PopoverContent className="w-56 p-1" align="end">
              <div className="flex items-center justify-between px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Venues</span>
                <span className="font-mono tabular-nums">
                  {venues.length}/{VENUE_IDS.length}
                </span>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-foreground hover:bg-accent">
                <span className="flex-1">All venues</span>
                <input
                  type="checkbox"
                  checked={allVenues}
                  onChange={() => onVenuesChange(allVenues ? [] : VENUE_IDS)}
                  className="size-3 accent-primary"
                />
              </label>
              <div className="my-1 border-t border-border/70" />
              {VENUE_CATALOG.map((venue) => {
                const checked = venues.includes(venue.id);
                const failure = venueErrors[venue.id];
                return (
                  <label
                    key={venue.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-foreground hover:bg-accent"
                  >
                    <VenueIcon venue={venue.id} size={14} />
                    <span className="min-w-0 flex-1 truncate">{venue.label}</span>
                    {failure ? (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-negative"
                        title={failure}
                        aria-label={failure}
                      />
                    ) : null}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVenue(venue.id)}
                      className="size-3 accent-primary"
                    />
                  </label>
                );
              })}
            </PopoverContent>
          </Popover.Root>
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
                {order.filter((key) => key !== 'symbol').map((key, index) => {
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
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {QUICK_FILTERS.map((option) => {
            const active = filters.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFilter(option.key)}
                className={cn(
                  'h-6 rounded-[4px] border px-2 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-primary/50 bg-primary-soft text-primary-foreground'
                    : 'border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full table-fixed border-collapse text-[12px]"
          style={{
            minWidth: visibleColumns.reduce(
              (sum, column) => sum + widthOf(column),
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
                  width: `${widthOf(column)}px`,
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>{visibleColumns.map(headerCell)}</tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const symbol = row.instrument.velaSymbol;
              const selected = Boolean(
                selectedSymbol && sameVelaSymbol(symbol, selectedSymbol),
              );
              return (
                <tr
                  key={row.instrument.key}
                  onClick={() => onSelect(symbol)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, symbol });
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
            {favoritesOnly ? (
              <Star className="size-5 opacity-40" />
            ) : venues.length === 0 ? (
              <Filter className="size-5 opacity-40" />
            ) : (
              <Search className="size-5 opacity-40" />
            )}
            <span className="text-[12px]">
              {venues.length === 0
                ? 'No venues selected. Choose at least one in the Venues filter.'
                : loading
                  ? 'Loading markets…'
                  : error
                    ? 'Market data unavailable'
                    : favoritesOnly
                      ? favorites.length === 0
                        ? `No favorites in ${activeFavoriteListName} yet. Click the star next to a symbol.`
                        : 'No favorites match your filters.'
                      : 'No markets found'}
            </span>
            {venues.length > 0 && error ? (
              <span className="max-w-60 text-center text-[10px] text-negative/80">{error}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex h-6 shrink-0 items-center justify-end border-t border-border bg-card/60 px-2 font-mono text-[10px] tabular-nums text-muted-foreground">
        {sortedRows.length}
        {rows.length !== sortedRows.length ? ` / ${rows.length}` : ''}
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
              {isOpen(menu.symbol) ? (
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

      <Modal
        open={listDialog !== null}
        onOpenChange={(open) => {
          if (!open) setListDialog(null);
        }}
        title={listDialog?.mode === 'rename' ? 'Rename list' : 'New list'}
        description="Favorites are saved on this device."
        footer={
          <>
            <Button variant="ghost" onClick={() => setListDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitFavoriteDialog}
              disabled={!listDialog?.name.trim()}
            >
              {listDialog?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </>
        }
      >
        <label className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Name
          </span>
          <Input
            autoFocus
            value={listDialog?.name ?? ''}
            placeholder="List name"
            onChange={(event) => {
              if (!listDialog) return;
              setListDialog({ ...listDialog, name: event.target.value, error: undefined });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitFavoriteDialog();
            }}
          />
        </label>
        {listDialog?.error ? (
          <p className="mt-2 text-[11px] text-negative">{listDialog.error}</p>
        ) : null}
      </Modal>
    </div>
  );
}
