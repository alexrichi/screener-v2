import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import type {
  PlotColumn,
  ScanProgress,
  ScanResult,
  ScreenerView,
  Settings,
  VenueId,
  WorkspaceTab,
} from './types';
import { AppHeader } from './components/AppHeader';
import { LibraryPanel } from './components/LibraryPanel';
import { PinePanel } from './components/PinePanel';
import { ScreenerTable } from './components/ScreenerTable';
import { SettingsDialog } from './components/SettingsDialog';
import { DEFAULT_VIEW, isScreenerView } from './lib/view';
import {
  VelaWorkspaceHost,
  type VelaWorkspaceHandle,
} from './components/VelaWorkspaceHost';
import { openVelaPanel, VelaPanelPortals } from './lib/velaPanels';
import { useMarketRows } from './hooks/useMarketRows';
import {
  isBoolean,
  isNumber,
  isString,
  usePersistedState,
} from './lib/usePersistedState';
import { scanTargetsFor, trimRowsPerVenue } from './lib/universe';
import {
  activeFavoriteList,
  addFavoriteList,
  clearFavoriteList,
  deleteFavoriteList,
  FAVORITES_STORAGE_KEY,
  initialFavoritesState,
  isFavoritesState,
  mergeFavoritesIntoActiveList,
  parseFavoritesFile,
  renameFavoriteList,
  selectFavoriteList,
  serializeFavorites,
  toggleFavoriteInActiveList,
  type FavoritesState,
} from './lib/favorites';
import {
  EMPTY_LIBRARY,
  INDICATOR_LIBRARY_KEY,
  createIndicator,
  hasName,
  isIndicatorLibrary,
  libraryJson,
  newIndicatorId,
  parseLibraryJson,
  pineFileName,
  type IndicatorLibrary,
  type SavedIndicator,
} from './lib/indicatorLibrary';
import { DEFAULT_SCRIPT } from './scripts/presets';
import { useScanner } from './scan/useScanner';
import { useTheme } from './ui/theme';
import { Button, Input } from './ui/primitives';
import { Modal } from './ui/overlays';
import { sameVelaSymbol } from './venues/instrument';
import { isVenueSelection, VENUE_IDS } from './venues/catalog';

const DEFAULT_SETTINGS: Settings = {
  minVolume: 1_000_000,
  topN: 100,
  scanTimeframe: '15',
  scanBars: 500,
  refreshSeconds: 5,
  defaultLayout: '1',
};

const LAYOUTS = new Set(['1', '2h', '2v', '4', '8']);

function isSettings(value: unknown): value is Settings {
  const settings = value as Partial<Settings>;
  return (
    typeof settings === 'object' &&
    settings !== null &&
    isNumber(settings.minVolume) &&
    isNumber(settings.topN) &&
    isNumber(settings.scanBars) &&
    isNumber(settings.refreshSeconds) &&
    isString(settings.scanTimeframe) &&
    isString(settings.defaultLayout) &&
    LAYOUTS.has(settings.defaultLayout)
  );
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  const tab = value as Partial<WorkspaceTab>;
  return (
    typeof tab === 'object' &&
    tab !== null &&
    isString(tab.id) &&
    isString(tab.symbol) &&
    isString(tab.timeframe) &&
    isString(tab.layout) &&
    isString(tab.altSymbol) &&
    (tab.pineScript === undefined || isString(tab.pineScript)) &&
    (tab.pineName === undefined || isString(tab.pineName)) &&
    (tab.pineAll === undefined || isBoolean(tab.pineAll))
  );
}

function isWorkspaceTabs(value: unknown): value is WorkspaceTab[] {
  return Array.isArray(value) && value.length > 0 && value.every(isWorkspaceTab);
}

function newTabId(): string {
  return `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function altFor(symbol: string): string {
  return symbol === 'ETHUSDT' ? 'BTCUSDT' : 'ETHUSDT';
}

function makeTab(symbol: string, layout: string, timeframe = '15'): WorkspaceTab {
  return {
    id: newTabId(),
    symbol,
    timeframe,
    layout,
    altSymbol: altFor(symbol),
  };
}

const NEW_SCRIPT = `//@version=6
indicator("My indicator")

plot(close)
`;

function suggestedName(source: string, fallback = 'My indicator'): string {
  const match = /(?:indicator|strategy|library)\s*\(\s*["']([^"']+)["']/.exec(source);
  return match?.[1]?.trim() || fallback;
}

function downloadText(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function uniqueName(items: SavedIndicator[], name: string): string {
  const base = name.trim() || 'Imported indicator';
  let candidate = base;
  let counter = 2;
  while (hasName(items, candidate)) {
    candidate = `${base} (${counter})`;
    counter += 1;
  }
  return candidate;
}

export default function App() {
  const { theme } = useTheme();
  const [settings, setSettings] = usePersistedState<Settings>(
    'screener.settings',
    DEFAULT_SETTINGS,
    isSettings,
  );
  const [marketVenues, setMarketVenues] = usePersistedState<VenueId[]>(
    'screener.marketVenues',
    VENUE_IDS,
    isVenueSelection,
  );
  const selectedVenues = useMemo(
    () => VENUE_IDS.filter((venue) => marketVenues.includes(venue)),
    [marketVenues],
  );
  const setVenues = useCallback(
    (next: VenueId[]) => {
      setMarketVenues(VENUE_IDS.filter((venue) => next.includes(venue)));
    },
    [setMarketVenues],
  );
  const { rows, loading, error, venueErrors, updatedAt, refresh } = useMarketRows(
    settings.refreshSeconds,
    selectedVenues,
  );

  const [tabs, setTabs] = usePersistedState<WorkspaceTab[]>(
    'screener.tabs',
    [
      {
        id: 'main',
        symbol: 'BTCUSDT',
        timeframe: '15',
        layout: settings.defaultLayout,
        altSymbol: 'ETHUSDT',
      },
    ],
    isWorkspaceTabs,
  );
  const [activeTabId, setActiveTabId] = usePersistedState<string>(
    'screener.activeTab',
    tabs[0]?.id ?? '',
    isString,
  );
  const [view, setView] = usePersistedState<ScreenerView>(
    'screener.view',
    DEFAULT_VIEW,
    isScreenerView,
  );
  const fallbackFavorites = useMemo(initialFavoritesState, []);
  const [favoritesState, setFavoritesState] = usePersistedState<FavoritesState>(
    FAVORITES_STORAGE_KEY,
    fallbackFavorites,
    isFavoritesState,
  );
  const activeFavorites = activeFavoriteList(favoritesState);
  const [script, setScript] = usePersistedState<string>(
    'screener.pine.script',
    DEFAULT_SCRIPT,
    isString,
  );
  const [library, setLibrary] = usePersistedState<IndicatorLibrary>(
    INDICATOR_LIBRARY_KEY,
    EMPTY_LIBRARY,
    isIndicatorLibrary,
  );
  const [currentSavedId, setCurrentSavedId] = usePersistedState<string>(
    'screener.pine.savedId',
    '',
    isString,
  );
  const [saveDialog, setSaveDialog] = useState<{
    mode: 'saveAs' | 'rename';
    id?: string;
    name: string;
    notes: string;
    error?: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanResults, setScanResults] = useState<Map<string, ScanResult>>(new Map());
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanMs, setLastScanMs] = useState<number | null>(null);
  const lastMarketError = useRef<string | null>(null);
  const workspaceRef = useRef<VelaWorkspaceHandle | null>(null);
  const newTabRef = useRef<string | null>(null);
  const scanner = useScanner();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const currentSaved =
    library.items.find((item) => item.id === currentSavedId) ?? null;
  const dirty = currentSaved ? currentSaved.source !== script : false;

  useEffect(() => {
    if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) return;
    setActiveTabId(tabs[0]?.id ?? '');
  }, [activeTabId, tabs, setActiveTabId]);

  useEffect(() => {
    if (!activeTabId || newTabRef.current !== activeTabId) return;
    newTabRef.current = null;
    openVelaPanel('screener');
  }, [activeTabId]);

  useEffect(() => {
    if (currentSavedId && !currentSaved) setCurrentSavedId('');
  }, [currentSaved, currentSavedId, setCurrentSavedId]);

  useEffect(() => {
    if (!error) {
      lastMarketError.current = null;
      return;
    }
    if (lastMarketError.current === error) return;
    lastMarketError.current = error;
    toast.error('Market data unavailable', { description: error });
  }, [error]);

  const filteredRows = useMemo(
    () => trimRowsPerVenue(rows, settings.minVolume, Math.max(1, settings.topN)),
    [rows, settings.minVolume, settings.topN],
  );

  const favoriteSymbols = useMemo(
    () => [...new Set(activeFavorites.items)],
    [activeFavorites.items],
  );
  const favoriteSet = useMemo(() => new Set(favoriteSymbols), [favoriteSymbols]);

  // The table keeps favorites visible even when they fall outside topN/minVolume.
  // The scanner still uses the trimmed universe above.
  const tableRows = useMemo(() => {
    const seen = new Set(filteredRows.map((row) => row.instrument.key));
    const extra = rows.filter(
      (row) =>
        favoriteSet.has(row.instrument.key) && !seen.has(row.instrument.key),
    );
    return [...filteredRows, ...extra];
  }, [filteredRows, favoriteSet, rows]);

  const toggleFavorite = useCallback(
    (key: string) => {
      setFavoritesState((prev) => toggleFavoriteInActiveList(prev, key));
    },
    [setFavoritesState],
  );

  const createFavoriteList = useCallback(
    (name: string) => {
      setFavoritesState((prev) => addFavoriteList(prev, name));
    },
    [setFavoritesState],
  );

  const renameFavoriteListById = useCallback(
    (id: string, name: string) => {
      setFavoritesState((prev) => renameFavoriteList(prev, id, name));
    },
    [setFavoritesState],
  );

  const deleteFavoriteListById = useCallback(
    (id: string) => {
      setFavoritesState((prev) => deleteFavoriteList(prev, id));
    },
    [setFavoritesState],
  );

  const clearFavoriteListById = useCallback(
    (id: string) => {
      setFavoritesState((prev) => clearFavoriteList(prev, id));
    },
    [setFavoritesState],
  );

  const selectFavoriteListById = useCallback(
    (id: string) => {
      setFavoritesState((prev) => selectFavoriteList(prev, id));
    },
    [setFavoritesState],
  );

  const exportFavorites = useCallback(() => {
    downloadText(
      'screener-favorites.json',
      serializeFavorites(favoritesState),
      'application/json;charset=utf-8',
    );
    toast.success('Favorites exported');
  }, [favoritesState]);

  const importFavorites = useCallback(
    async (file: File) => {
      try {
        const parsed = parseFavoritesFile(await file.text());
        const imported = parsed.lists.reduce(
          (sum, list) => sum + list.items.length,
          0,
        );
        if (imported === 0) {
          toast.error('No favorite tickers found', {
            description: parsed.skipped
              ? `${parsed.skipped} entries skipped`
              : undefined,
          });
          return;
        }
        setFavoritesState((prev) =>
          mergeFavoritesIntoActiveList(prev, parsed.lists),
        );
        const details = [
          `Added to ${activeFavorites.name}`,
          parsed.skipped ? `${parsed.skipped} entries skipped` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        toast.success(
          `Imported ${imported} favorite${imported === 1 ? '' : 's'}`,
          { description: details || undefined },
        );
      } catch (cause) {
        toast.error('Could not import favorites', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [setFavoritesState, activeFavorites.name],
  );

  const openSymbols = useMemo(() => tabs.map((tab) => tab.symbol), [tabs]);

  const plotColumns = useMemo<PlotColumn[]>(() => {
    const ordered = [...scanResults.values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const columns = new Map<string, PlotColumn>();
    for (const result of ordered) {
      for (const plot of result.plots) {
        const key = `plot:${plot.key}`;
        if (!columns.has(key)) {
          columns.set(key, { key, plotKey: plot.key, title: plot.title });
        }
      }
    }
    return [...columns.values()];
  }, [scanResults]);

  const failedScans = useMemo(
    () => [...scanResults.values()].filter((result) => result.error).length,
    [scanResults],
  );

  const scanErrorMessage = useMemo(() => {
    if (scanError) return scanError;
    if (scanResults.size > 0 && failedScans === scanResults.size) {
      return [...scanResults.values()].find((result) => result.error)?.error ?? null;
    }
    return null;
  }, [failedScans, scanError, scanResults]);

  const handleMarketChange = useCallback(
    (tabId: string, patch: { symbol?: string; timeframe?: string; layout?: string }) => {
      setTabs((prev) => {
        const tab = prev.find((item) => item.id === tabId);
        if (!tab) return prev;
        const next = { ...tab, ...patch };
        if (
          next.symbol === tab.symbol &&
          next.timeframe === tab.timeframe &&
          next.layout === tab.layout
        ) {
          return prev;
        }
        return prev.map((item) => (item.id === tabId ? next : item));
      });
    },
    [setTabs],
  );

  const selectSymbol = useCallback(
    (symbol: string) => {
      if (!activeTab) return;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                symbol,
                altSymbol: symbol === tab.altSymbol ? altFor(symbol) : tab.altSymbol,
              }
            : tab,
        ),
      );
      workspaceRef.current?.setActiveSymbol(symbol);
    },
    [activeTab, setTabs],
  );

  const addTab = useCallback(
    (symbol: string) => {
      const tab = makeTab(
        symbol,
        settings.defaultLayout,
        activeTab?.timeframe ?? '15',
      );
      newTabRef.current = tab.id;
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [activeTab?.timeframe, setActiveTabId, setTabs, settings.defaultLayout],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const index = prev.findIndex((tab) => tab.id === id);
        if (index < 0) return prev;
        const rest = prev.filter((tab) => tab.id !== id);
        if (id === activeTabId) {
          setActiveTabId(rest[Math.min(index, rest.length - 1)]?.id ?? '');
        }
        return rest;
      });
    },
    [activeTabId, setActiveTabId, setTabs],
  );

  const closeTabBySymbol = useCallback(
    (symbol: string) => {
      const tab = tabs.find((item) => sameVelaSymbol(item.symbol, symbol));
      if (tab) closeTab(tab.id);
    },
    [closeTab, tabs],
  );

  const moveTab = useCallback(
    (from: string, to: string) => {
      setTabs((prev) => {
        const fromIndex = prev.findIndex((tab) => tab.id === from);
        const toIndex = prev.findIndex((tab) => tab.id === to);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [setTabs],
  );

  const runScan = useCallback(
    (source: string = script) => {
      if (!source.trim()) {
        toast.error('Pine script is empty');
        return;
      }
      if (selectedVenues.length === 0) {
        toast.error('Select at least one venue');
        return;
      }
      const targets = scanTargetsFor(filteredRows, selectedVenues);
      const total = targets.reduce(
        (sum, target) => sum + target.instruments.length,
        0,
      );
      if (total === 0) {
        toast.error('No symbols match the universe filter');
        return;
      }
      setScanResults(new Map());
      setScanError(null);
      setScanProgress({ done: 0, total });
      setLastScanMs(null);
      const started = performance.now();
      scanner.scan(
        {
          script: source,
          timeframe: settings.scanTimeframe,
          targets,
          bars: settings.scanBars,
          concurrency: 6,
        },
        {
          onProgress: (progress) => setScanProgress(progress),
          onResult: (result) => {
            setScanResults((prev) => {
              const next = new Map(prev);
              next.set(result.key, result);
              return next;
            });
          },
          onDone: () => {
            setScanProgress(null);
            setLastScanMs(Math.round(performance.now() - started));
          },
          onFatal: (message) => {
            setScanProgress(null);
            setScanError(message);
          },
        },
      );
    },
    [
      filteredRows,
      scanner,
      script,
      selectedVenues,
      settings.scanBars,
      settings.scanTimeframe,
    ],
  );

  const cancelScan = useCallback(() => {
    scanner.stop();
    setScanProgress(null);
  }, [scanner]);

  const applyScript = useCallback(
    (source: string, allCells: boolean) => {
      if (!source.trim()) {
        toast.error('Pine script is empty');
        return;
      }
      try {
        const name =
          currentSaved && currentSaved.source === source
            ? currentSaved.name
            : 'Screener Pine';
        const count = workspaceRef.current?.applyScript(source, name, allCells) ?? 0;
        if (count > 0) {
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab?.id
                ? { ...tab, pineScript: source, pineName: name, pineAll: allCells }
                : tab,
            ),
          );
          toast.success(
            allCells
              ? `Applied to ${count} chart${count === 1 ? '' : 's'}`
              : 'Applied to the active chart',
          );
        } else {
          toast.error('The chart is not ready yet');
        }
      } catch (cause) {
        toast.error('Pine script could not be applied', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [activeTab?.id, currentSaved, setTabs],
  );

  const openSaveAs = useCallback(
    (source = script) => {
      setSaveDialog({
        mode: 'saveAs',
        name: suggestedName(source, currentSaved?.name ?? 'My indicator'),
        notes: '',
      });
    },
    [currentSaved?.name, script],
  );

  const saveCurrent = useCallback(() => {
    if (!script.trim()) {
      toast.error('Pine script is empty');
      return;
    }
    if (currentSaved) {
      setLibrary((prev) => ({
        version: 1,
        items: prev.items.map((item) =>
          item.id === currentSaved.id
            ? {
                ...item,
                source: script,
                updatedAt: Date.now(),
                version: item.version + 1,
              }
            : item,
        ),
      }));
      toast.success(`Saved ${currentSaved.name}`);
      return;
    }
    openSaveAs(script);
  }, [currentSaved, openSaveAs, script, setLibrary]);

  const commitSaveDialog = useCallback(() => {
    if (!saveDialog) return;
    const name = saveDialog.name.trim();
    if (!name) {
      setSaveDialog({ ...saveDialog, error: 'Enter a name' });
      return;
    }
    if (hasName(library.items, name, saveDialog.id)) {
      setSaveDialog({ ...saveDialog, error: 'That name is already used' });
      return;
    }
    if (saveDialog.mode === 'rename' && saveDialog.id) {
      setLibrary((prev) => ({
        version: 1,
        items: prev.items.map((item) =>
          item.id === saveDialog.id
            ? {
                ...item,
                name,
                notes: saveDialog.notes.trim() || undefined,
                updatedAt: Date.now(),
                version: item.version + 1,
              }
            : item,
        ),
      }));
      toast.success('Indicator renamed');
    } else {
      const item = createIndicator(name, script, saveDialog.notes);
      setLibrary((prev) => ({ version: 1, items: [...prev.items, item] }));
      setCurrentSavedId(item.id);
      toast.success(`Saved ${item.name}`);
    }
    setSaveDialog(null);
  }, [library.items, saveDialog, script, setCurrentSavedId, setLibrary]);

  const selectSaved = useCallback(
    (id: string) => {
      const item = library.items.find((candidate) => candidate.id === id);
      if (!item) return;
      if (dirty && !window.confirm('Discard unsaved changes?')) return;
      setScript(item.source);
      setCurrentSavedId(id);
      openVelaPanel('pine');
    },
    [dirty, library.items, setCurrentSavedId, setScript],
  );

  const showSource = useCallback(
    (source: string) => {
      if (!source.trim()) return;
      if (dirty && !window.confirm('Discard unsaved changes?')) return;
      const saved = library.items.find((item) => item.source === source);
      setScript(source);
      setCurrentSavedId(saved?.id ?? '');
      openVelaPanel('pine');
    },
    [dirty, library.items, setCurrentSavedId, setScript],
  );

  const usePreset = useCallback(
    (source: string) => {
      if (dirty && !window.confirm('Discard unsaved changes?')) return;
      setScript(source);
      setCurrentSavedId('');
    },
    [dirty, setCurrentSavedId, setScript],
  );

  const newDraft = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setScript(NEW_SCRIPT);
    setCurrentSavedId('');
    openVelaPanel('pine');
  }, [dirty, setCurrentSavedId, setScript]);

  const renameIndicator = useCallback((item: SavedIndicator) => {
    setSaveDialog({
      mode: 'rename',
      id: item.id,
      name: item.name,
      notes: item.notes ?? '',
    });
  }, []);

  const duplicateIndicator = useCallback(
    (item: SavedIndicator) => {
      const name = uniqueName(library.items, `${item.name} copy`);
      const copy: SavedIndicator = {
        ...item,
        id: newIndicatorId(),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };
      setLibrary((prev) => ({ version: 1, items: [...prev.items, copy] }));
      setScript(copy.source);
      setCurrentSavedId(copy.id);
      openVelaPanel('pine');
      toast.success(`Duplicated as ${name}`);
    },
    [library.items, setCurrentSavedId, setLibrary, setScript],
  );

  const deleteIndicator = useCallback(
    (item: SavedIndicator) => {
      if (!window.confirm(`Delete "${item.name}"?`)) return;
      setLibrary((prev) => ({
        version: 1,
        items: prev.items.filter((candidate) => candidate.id !== item.id),
      }));
      if (currentSavedId === item.id) setCurrentSavedId('');
      toast.success(`Deleted ${item.name}`);
    },
    [currentSavedId, setCurrentSavedId, setLibrary],
  );

  const exportIndicator = useCallback((item: SavedIndicator) => {
    downloadText(pineFileName(item.name), item.source, 'text/plain;charset=utf-8');
  }, []);

  const exportLibrary = useCallback(() => {
    downloadText(
      'screener-indicators.json',
      libraryJson(library),
      'application/json;charset=utf-8',
    );
  }, [library]);

  const importLibraryFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const lower = file.name.toLowerCase();
        if (!lower.endsWith('.json')) {
          const fallback = file.name.replace(/\.pine$/i, '') || suggestedName(text);
          const name = uniqueName(library.items, fallback);
          const item = createIndicator(name, text);
          setLibrary((prev) => ({ version: 1, items: [...prev.items, item] }));
          setScript(item.source);
          setCurrentSavedId(item.id);
          openVelaPanel('pine');
          toast.success(`Imported ${item.name}`);
          return;
        }
        const parsed = parseLibraryJson(text);
        setLibrary((prev) => {
          const items = [...prev.items];
          for (const item of parsed.items) {
            const name = uniqueName(items, item.name);
            items.push({
              ...item,
              id: newIndicatorId(),
              name,
              createdAt: item.createdAt || Date.now(),
              updatedAt: Date.now(),
            });
          }
          return { version: 1, items };
        });
        toast.success(`Imported ${parsed.items.length} indicators`);
      } catch (cause) {
        toast.error('Could not import indicators', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [library.items, setCurrentSavedId, setLibrary, setScript],
  );

  const addSavedToChart = useCallback(
    (item: SavedIndicator, allCells: boolean) => {
      const count = workspaceRef.current?.addSavedIndicator(item.name, allCells) ?? 0;
      if (count > 0) {
        toast.success(
          allCells
            ? `Added ${item.name} to ${count} chart${count === 1 ? '' : 's'}`
            : `Added ${item.name} to the active chart`,
        );
        openVelaPanel('screener');
      } else {
        toast.error('The chart is not ready yet');
      }
    },
    [],
  );

  const scanSaved = useCallback(
    (item: SavedIndicator) => {
      setScript(item.source);
      setCurrentSavedId(item.id);
      openVelaPanel('pine');
      runScan(item.source);
    },
    [runScan, setCurrentSavedId, setScript],
  );

  const saveSettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      toast.success('Settings saved');
    },
    [setSettings],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        tabs={tabs}
        activeId={activeTab?.id ?? ''}
        rows={rows}
        venues={selectedVenues}
        loading={loading}
        error={error}
        updatedAt={updatedAt}
        onActivate={setActiveTabId}
        onClose={closeTab}
        onMove={moveTab}
        onAdd={addTab}
        onRefresh={() => void refresh()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <section className="relative min-w-0 flex-1 overflow-hidden bg-background">
          {activeTab ? (
            <VelaWorkspaceHost
              key={activeTab.id}
              ref={workspaceRef}
              tab={activeTab}
              theme={theme}
              savedScripts={library.items}
              onShowSource={showSource}
              onMarketChange={handleMarketChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              Create a workspace to start.
            </div>
          )}
        </section>

        <VelaPanelPortals
          panels={{
            screener: (
              <ScreenerTable
                rows={tableRows}
                view={view}
                onViewChange={setView}
                venues={selectedVenues}
                onVenuesChange={setVenues}
                venueErrors={venueErrors}
                favorites={favoriteSymbols}
                favoriteLists={favoritesState.lists}
                activeFavoriteListId={activeFavorites.id}
                activeFavoriteListName={activeFavorites.name}
                onSelectFavoriteList={selectFavoriteListById}
                onCreateFavoriteList={createFavoriteList}
                onRenameFavoriteList={renameFavoriteListById}
                onClearFavoriteList={clearFavoriteListById}
                onDeleteFavoriteList={deleteFavoriteListById}
                onImportFavorites={(file) => void importFavorites(file)}
                onExportFavorites={exportFavorites}
                onToggleFavorite={toggleFavorite}
                selectedSymbol={activeTab?.symbol ?? ''}
                openSymbols={openSymbols}
                scanResults={scanResults}
                plotColumns={plotColumns}
                loading={loading}
                error={error}
                onSelect={selectSymbol}
                onOpenTab={addTab}
                onCloseTab={closeTabBySymbol}
              />
            ),
            pine: (
              <PinePanel
                script={script}
                onScriptChange={setScript}
                savedItems={library.items}
                currentSavedId={currentSavedId}
                dirty={dirty}
                onSelectSaved={selectSaved}
                onUsePreset={usePreset}
                onSave={saveCurrent}
                onNew={newDraft}
                scanTimeframe={settings.scanTimeframe}
                onScanTimeframeChange={(scanTimeframe) =>
                  setSettings((prev) => ({ ...prev, scanTimeframe }))
                }
                scanBars={settings.scanBars}
                onScanBarsChange={(scanBars) =>
                  setSettings((prev) => ({ ...prev, scanBars }))
                }
                onApply={applyScript}
                onScan={() => runScan()}
                onCancel={cancelScan}
                scanning={scanner.running}
                progress={scanProgress}
                error={scanErrorMessage}
                resultCount={scanResults.size}
                plotColumns={plotColumns}
                lastScanMs={lastScanMs}
              />
            ),
            library: (
              <LibraryPanel
                items={library.items}
                currentId={currentSavedId}
                onNew={newDraft}
                onEdit={(item) => selectSaved(item.id)}
                onAdd={addSavedToChart}
                onScan={scanSaved}
                onRename={renameIndicator}
                onDuplicate={duplicateIndicator}
                onDelete={deleteIndicator}
                onExport={exportIndicator}
                onExportAll={exportLibrary}
                onImportFile={(file) => void importLibraryFile(file)}
              />
            ),
          }}
        />
      </main>

      <Modal
        open={saveDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSaveDialog(null);
        }}
        title={saveDialog?.mode === 'rename' ? 'Rename indicator' : 'Save indicator'}
        description="The library stores the exact .pine source"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commitSaveDialog}>
              {saveDialog?.mode === 'rename' ? 'Rename' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Name
            </span>
            <Input
              autoFocus
              value={saveDialog?.name ?? ''}
              onChange={(event) =>
                setSaveDialog((prev) =>
                  prev ? { ...prev, name: event.target.value, error: undefined } : prev,
                )
              }
              placeholder="EMA cross"
            />
          </label>
          {saveDialog?.error ? (
            <p className="text-[11px] text-negative">{saveDialog.error}</p>
          ) : null}
          <label className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </span>
            <textarea
              value={saveDialog?.notes ?? ''}
              onChange={(event) =>
                setSaveDialog((prev) =>
                  prev ? { ...prev, notes: event.target.value } : prev,
                )
              }
              rows={3}
              placeholder="What this indicator does, inputs, caveats…"
              className="w-full resize-y rounded-md border border-border bg-muted/40 p-2 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      </Modal>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSave={saveSettings}
      />

      {failedScans > 0 && !scanProgress ? (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-md border border-negative/30 bg-card/95 px-3 py-1.5 text-[11px] text-negative shadow-lg">
          {failedScans} symbol{failedScans === 1 ? '' : 's'} failed during the last scan
        </div>
      ) : null}

      <Toaster
        theme={theme}
        position="bottom-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: 'font-sans',
          },
        }}
      />
    </div>
  );
}
