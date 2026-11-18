import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Popover } from '@base-ui/react';
import {
  ChevronRight,
  Menu as MenuIcon,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  X,
} from 'lucide-react';
import type { MarketRow, VenueId, WorkspaceTab } from '../types';
import { symbolLabel } from '../lib/binance';
import { formatClock, formatPrice, layoutLabel } from '../lib/format';
import { BUILD_VERSION } from '../lib/buildVersion';
import { openVelaPanel } from '../lib/velaPanels';
import { VENUE_CATALOG, venueLabel } from '../venues/catalog';
import { VenueIcon } from '../venues/venueIcons';
import { useTheme } from '../ui/theme';
import { cn } from '../ui/cn';
import { IconButton, Input } from '../ui/primitives';
import { Modal, PopoverContent } from '../ui/overlays';

const menuPopupClass =
  'z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-[12px] text-popover-foreground shadow-2xl outline-none';
const menuItemClass =
  'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40';
const submenuTriggerClass = `${menuItemClass} data-[popup-open]:bg-accent`;

interface Props {
  tabs: WorkspaceTab[];
  activeId: string;
  rows: MarketRow[];
  venues: VenueId[];
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (from: string, to: string) => void;
  onAdd: (symbol: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  aiOpen: boolean;
  /** Clamped sidebar width; when open it also offsets the tab strip. */
  aiWidth: number;
}

export function AppHeader({
  tabs,
  activeId,
  rows,
  venues,
  loading,
  error,
  updatedAt,
  onActivate,
  onClose,
  onMove,
  onAdd,
  onRefresh,
  onOpenSettings,
  aiOpen,
  aiWidth,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const windowApi = typeof window === 'undefined' ? undefined : window.screenerWindow;

  useEffect(() => {
    windowApi?.setTitleBarTheme(theme);
  }, [theme, windowApi]);

  useEffect(() => {
    if (!pickerOpen) return;
    setQuery('');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [pickerOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    const source = needle
      ? rows.filter((row) => {
          const instrument = row.instrument;
          return (
            instrument.nativeId.includes(needle) ||
            instrument.base.includes(needle) ||
            venueLabel(instrument.venue).toUpperCase().includes(needle)
          );
        })
      : rows;
    return source.slice(0, 80);
  }, [query, rows]);

  const statusTone = error ? 'bg-negative' : loading ? 'bg-amber-400' : 'bg-positive';
  const venueSummary =
    venues.length === 0
      ? 'No venues'
      : venues.length === VENUE_CATALOG.length
        ? 'All venues'
        : venues.length === 1
          ? venueLabel(venues[0]!)
          : `${venues.length} venues`;

  return (
    <>
      <header className="app-titlebar flex h-9 shrink-0 items-stretch border-b border-border bg-background">
        <div
          className="flex shrink-0 items-center gap-1.5 overflow-hidden border-r border-border px-2.5"
          style={aiOpen ? { width: aiWidth } : undefined}
        >
          <img
            src="/icon.png"
            alt="Screener"
            title="Screener"
            width={24}
            height={24}
            draggable={false}
            className="size-6 shrink-0 rounded-md"
          />
          <Menu.Root>
            <Menu.Trigger
              title="Application menu"
              aria-label="Application menu"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground"
            >
              <MenuIcon className="size-4" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                side="bottom"
                align="start"
                sideOffset={6}
                className="z-50 outline-none"
              >
                <Menu.Popup className={menuPopupClass}>
                  <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Screener
                  </div>

                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className={submenuTriggerClass}>
                      File
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    </Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        side="right"
                        align="start"
                        sideOffset={4}
                        className="z-50 outline-none"
                      >
                        <Menu.Popup className={menuPopupClass}>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => setPickerOpen(true)}
                          >
                            New workspace
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={onRefresh}
                            disabled={loading}
                          >
                            Refresh markets
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={onOpenSettings}
                          >
                            Settings
                          </Menu.Item>
                          <Menu.Separator className="my-1 h-px bg-border" />
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => windowApi?.quit()}
                            disabled={!windowApi}
                          >
                            Quit
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>

                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className={submenuTriggerClass}>
                      View
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    </Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        side="right"
                        align="start"
                        sideOffset={4}
                        className="z-50 outline-none"
                      >
                        <Menu.Popup className={menuPopupClass}>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => openVelaPanel('screener')}
                          >
                            Screener
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => openVelaPanel('pine')}
                          >
                            Pine
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => openVelaPanel('library')}
                          >
                            Library
                          </Menu.Item>
                          <Menu.Separator className="my-1 h-px bg-border" />
                          <Menu.Item
                            className={menuItemClass}
                            onClick={toggleTheme}
                          >
                            {theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => window.location.reload()}
                          >
                            Reload
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>

                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className={submenuTriggerClass}>
                      Window
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    </Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        side="right"
                        align="start"
                        sideOffset={4}
                        className="z-50 outline-none"
                      >
                        <Menu.Popup className={menuPopupClass}>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => windowApi?.minimize()}
                            disabled={!windowApi}
                          >
                            Minimize
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => windowApi?.toggleMaximize()}
                            disabled={!windowApi}
                          >
                            Maximize / Restore
                          </Menu.Item>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => windowApi?.close()}
                            disabled={!windowApi}
                          >
                            Close
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>

                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className={submenuTriggerClass}>
                      Help
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    </Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        side="right"
                        align="start"
                        sideOffset={4}
                        className="z-50 outline-none"
                      >
                        <Menu.Popup className={menuPopupClass}>
                          <Menu.Item
                            className={menuItemClass}
                            onClick={() => setAboutOpen(true)}
                          >
                            About Screener
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
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
                <span className="max-w-24 truncate">{symbolLabel(tab.symbol)}</span>
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
                placeholder="Search symbol or venue…"
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
                    key={row.instrument.key}
                    type="button"
                    title={`${row.instrument.velaSymbol} · ${venueLabel(
                      row.instrument.venue,
                    )}`}
                    onClick={() => {
                      onAdd(row.instrument.velaSymbol);
                      setPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <VenueIcon venue={row.instrument.venue} size={14} />
                    <span className="w-16 shrink-0 truncate text-[12px] font-semibold text-foreground">
                      {row.instrument.base}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                      {row.instrument.display}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatPrice(row.price, row.instrument.pricePrecision)}
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
          <span className="font-medium text-foreground/80">{venueSummary}</span>
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
      </div>
    </header>

    <Modal
      open={aboutOpen}
      onOpenChange={setAboutOpen}
      title="About Screener"
      description="Multi-venue crypto screener"
    >
      <div className="grid gap-2 text-[12px] leading-5 text-muted-foreground">
        <p className="text-[13px] font-semibold text-foreground">Screener v2</p>
        <p>
          Public market data from Binance, OKX, Bybit, Bitget, Hyperliquid, and
          Coinbase.
        </p>
        <p>Vite + React + Vela + a local Pine engine. No account, no trading.</p>
        <p className="font-mono text-[10px]">
          Version {BUILD_VERSION} · {windowApi ? 'Electron desktop build' : 'Browser build'}
        </p>
      </div>
    </Modal>
  </>
  );
}
