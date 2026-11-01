import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react';
import {
  CandlestickChart,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type { MarketRow, WorkspaceTab } from '../types';
import { baseFromSymbol } from '../lib/binance';
import { formatClock, formatPrice, layoutLabel } from '../lib/format';
import { useTheme } from '../ui/theme';
import { cn } from '../ui/cn';
import { IconButton, Input } from '../ui/primitives';
import { PopoverContent } from '../ui/overlays';

interface Props {
  tabs: WorkspaceTab[];
  activeId: string;
  rows: MarketRow[];
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (from: string, to: string) => void;
  onAdd: (symbol: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function AppHeader({
  tabs,
  activeId,
  rows,
  loading,
  error,
  updatedAt,
  onActivate,
  onClose,
  onMove,
  onAdd,
  onRefresh,
  onOpenSettings,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    setQuery('');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [pickerOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    const source = needle
      ? rows.filter(
          (row) => row.symbol.includes(needle) || row.base.includes(needle),
        )
      : rows;
    return source.slice(0, 80);
  }, [query, rows]);

  const statusTone = error ? 'bg-negative' : loading ? 'bg-amber-400' : 'bg-positive';

  return (
    <header className="flex h-9 shrink-0 items-stretch border-b border-border bg-background">
      <div className="flex shrink-0 items-center gap-2 border-r border-border px-2.5">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
          <CandlestickChart className="size-3.5" />
        </div>
        <span className="hidden text-[13px] font-semibold tracking-tight text-foreground sm:inline">
          Screener
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-stretch gap-px overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const dragging = dragId === tab.id;
          const over = overId === tab.id && dragId !== tab.id;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(event) => {
                setDragId(tab.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.id);
              }}
              onDragOver={(event) => {
                if (!dragId || dragId === tab.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOverId(tab.id);
              }}
              onDragLeave={() => setOverId((prev) => (prev === tab.id ? null : prev))}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragId ?? event.dataTransfer.getData('text/plain');
                if (from && from !== tab.id) onMove(from, tab.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              className={cn(
                'group flex shrink-0 items-center self-center rounded-md border transition-colors',
                dragging && 'opacity-40',
                over && 'border-primary/50 bg-primary-soft',
                active
                  ? 'border-primary/35 bg-primary-soft text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <button
                type="button"
                onClick={() => onActivate(tab.id)}
                title={`${tab.symbol} · ${tab.timeframe} · ${layoutLabel(tab.layout)}`}
                className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-[12px] font-medium"
              >
                <span className="max-w-24 truncate">{baseFromSymbol(tab.symbol)}</span>
                <span
                  className={cn(
                    'rounded border px-1 font-mono text-[9px] leading-4',
                    active
                      ? 'border-primary/30 bg-primary/15 text-primary-foreground/90'
                      : 'border-border bg-muted/60 text-muted-foreground',
                  )}
                >
                  {layoutLabel(tab.layout)}
                </span>
              </button>
              {tabs.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onClose(tab.id)}
                  title="Close workspace"
                  className={cn(
                    'mr-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-black/20 hover:text-negative',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          );
        })}

        <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
          <Popover.Trigger
            title="New workspace"
            aria-label="New workspace"
            className="my-1 ml-1 inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </Popover.Trigger>
          <PopoverContent className="w-80 p-2" align="start">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Binance futures…"
                className="h-8 pl-7"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {matches.length === 0 ? (
                <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                  {loading ? 'Loading markets…' : 'Nothing found'}
                </div>
              ) : (
                matches.map((row) => (
                  <button
                    key={row.symbol}
                    type="button"
                    onClick={() => {
                      onAdd(row.symbol);
                      setPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span className="w-16 shrink-0 truncate text-[12px] font-semibold text-foreground">
                      {row.base}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                      {row.symbol}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatPrice(row.price, row.pricePrecision)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover.Root>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-border px-2">
        <span
          className={cn('size-1.5 rounded-full', statusTone)}
          title={error ?? (loading ? 'Refreshing' : 'Connected')}
        />
        <span className="hidden items-center gap-1 text-[11px] text-muted-foreground xl:flex">
          <span className="font-medium text-foreground/80">Binance</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono tabular-nums">{formatClock(updatedAt)}</span>
        </span>
        <IconButton label="Refresh markets" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </IconButton>
        <IconButton
          label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}>
          <Settings className="size-3.5" />
        </IconButton>
      </div>
    </header>
  );
}
