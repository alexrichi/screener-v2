import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { registerIcon, registerLegendAction } from '@luxalgo/vela/plugin';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';
import type { ThemeMode, WorkspaceTab } from '../types';
import { chartSymbol, spotSymbol } from '../lib/binance';
import { clearMaximizeBridge, setMaximizeBridge } from '../lib/velaMaximize';
import { velaDarkTheme, velaLightTheme } from '../lib/velaTheme';

export interface SavedScript {
  id: string;
  name: string;
  source: string;
}

export interface VelaWorkspaceHandle {
  applyScript: (script: string, name: string, allCells: boolean) => number;
  addSavedIndicator: (name: string, allCells: boolean) => number;
  removeScript: () => void;
  setActiveSymbol: (symbol: string) => void;
  setActiveTimeframe: (timeframe: string) => void;
  setLayout: (layout: string) => void;
  workspace: () => VelaWorkspace | null;
}

interface Props {
  tab: WorkspaceTab;
  theme: ThemeMode;
  savedScripts: SavedScript[];
  onShowSource: (source: string) => void;
  onMarketChange: (
    tabId: string,
    patch: { symbol?: string; timeframe?: string; layout?: string },
  ) => void;
}

const PINE_ID = 'screener-pine';
const SOURCE_ACTION_ID = 'screener-show-source';

let showSourceHandler: ((source: string) => void) | null = null;

registerIcon(
  'screener-source',
  '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
);

registerLegendAction({
  id: SOURCE_ACTION_ID,
  icon: 'screener-source',
  tooltip: 'Show source code',
  when: (indicator) => indicator.source !== undefined,
  run: (_ctx, indicator) => {
    if (indicator.source) showSourceHandler?.(indicator.source);
  },
});

const EXTRA_SYMBOLS = [
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'LINKUSDT',
  'AVAXUSDT',
  'LTCUSDT',
];

function applyToCells(
  ws: VelaWorkspace,
  script: string,
  name: string,
  allCells: boolean,
): number {
  const cells = allCells ? ws.cells() : [ws.active];
  let count = 0;
  for (const cell of cells) {
    const existing = cell.instances.find((item) => item.id === PINE_ID);
    existing?.handle?.remove();
    cell.addExternalIndicator({ id: PINE_ID, name, script, language: 'pine' });
    count += 1;
  }
  return count;
}

function manifestOf(scripts: SavedScript[]) {
  return scripts.map((script) => ({
    name: script.name,
    script: script.source,
    language: 'pine',
    enabled: false,
    category: 'My scripts',
  }));
}

export const VelaWorkspaceHost = forwardRef<VelaWorkspaceHandle, Props>(
  function VelaWorkspaceHost(
    { tab, theme, savedScripts, onShowSource, onMarketChange },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<VelaWorkspace | null>(null);
    const lastAppliedRef = useRef<string | null>(null);
    const onMarketChangeRef = useRef(onMarketChange);
    onMarketChangeRef.current = onMarketChange;
    const onShowSourceRef = useRef(onShowSource);
    onShowSourceRef.current = onShowSource;
    const savedScriptsRef = useRef(savedScripts);
    savedScriptsRef.current = savedScripts;

    useEffect(() => {
      showSourceHandler = (source) => onShowSourceRef.current(source);
      return () => {
        showSourceHandler = null;
      };
    }, []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      lastAppliedRef.current = null;
      const wantedLayout = tab.layout || '1';
      // Seed every layout slot so 2×2 and 4×2 reveal useful majors rather than
      // duplicate copies of the active symbol.
      const seedLayout = wantedLayout === '1' ? '2h' : wantedLayout;
      const cellSeeds: Record<string, { symbol: string; timeframe: string }> = {
        main: { symbol: chartSymbol(tab.symbol), timeframe: tab.timeframe },
        alt: {
          symbol: chartSymbol(tab.altSymbol || 'ETHUSDT'),
          timeframe: tab.timeframe,
        },
      };
      const extras = EXTRA_SYMBOLS.filter(
        (symbol) => symbol !== tab.symbol && symbol !== tab.altSymbol,
      ).slice(0, 6);
      extras.forEach((symbol, index) => {
        cellSeeds[`extra${index + 1}`] = {
          symbol: chartSymbol(symbol),
          timeframe: tab.timeframe,
        };
      });
      const ws = new VelaWorkspace(host, {
        layout: seedLayout,
        symbol: chartSymbol(tab.symbol),
        timeframe: tab.timeframe,
        cells: cellSeeds,
        providers: { binance: () => new BinanceProvider() },
        engines: { pine: () => new PineWorkerEngine() },
        indicators: manifestOf(savedScriptsRef.current),
        live: true,
        theme: theme === 'dark' ? velaDarkTheme : velaLightTheme,
        timezone: 'UTC',
        persist: `screener-v2:ws:${tab.id}`,
        drawingToolbar: true,
        maxWebglCells: 8,
      });
      wsRef.current = ws;
      if (seedLayout !== wantedLayout) ws.setLayout(wantedLayout);
      const wantedSymbol = chartSymbol(tab.symbol);
      const matchingCell = ws.cells().find((cell) => cell.symbol === wantedSymbol);
      if (matchingCell) ws.setActiveCell(matchingCell.id);
      if (tab.pineScript) {
        try {
          applyToCells(
            ws,
            tab.pineScript,
            tab.pineName ?? 'Screener Pine',
            tab.pineAll ?? false,
          );
          lastAppliedRef.current = tab.pineScript;
        } catch (cause) {
          console.warn('[screener] could not restore the Pine script', cause);
        }
      }

      let timer: number | null = null;
      const sync = () => {
        if (wsRef.current !== ws) return;
        try {
          const cell = ws.active;
          const symbol = spotSymbol(cell.symbol);
          const timeframe = cell.timeframe;
          const layout = ws.layout.id;
          onMarketChangeRef.current(tab.id, { symbol, timeframe, layout });
        } catch {
          /* the workspace can be between teardown and destroy */
        }
      };
      const scheduleSync = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          sync();
        }, 120);
      };

      const syncMaximize = () => {
        if (wsRef.current !== ws) return;
        setMaximizeBridge({
          maximized: ws.maximizedCell !== null,
          multi: ws.cells().length > 1,
          toggle: () => {
            if (ws.maximizedCell !== null) ws.maximizeCell(null);
            else if (ws.active) ws.maximizeCell(ws.active.id);
          },
        });
        ws.refreshActions();
      };
      syncMaximize();

      const offState = ws.on('state:changed', scheduleSync);
      const offActive = ws.on('cell:active', scheduleSync);
      const offLayout = ws.on('layout:changed', () => {
        scheduleSync();
        syncMaximize();
      });
      const offMaximized = ws.on('cell:maximized', syncMaximize);

      return () => {
        if (timer !== null) window.clearTimeout(timer);
        offState();
        offActive();
        offLayout();
        offMaximized();
        clearMaximizeBridge();
        ws.destroy();
        if (wsRef.current === ws) wsRef.current = null;
      };
      // The host is recreated per workspace tab. Theme and prop sync are separate.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.id]);

    useEffect(() => {
      const ws = wsRef.current;
      if (!ws) return;
      ws.setTheme(theme === 'dark' ? velaDarkTheme : velaLightTheme);
    }, [theme]);

    useEffect(() => {
      const ws = wsRef.current;
      if (!ws) return;
      void ws.setIndicators(manifestOf(savedScripts)).catch((cause) => {
        console.warn('[screener] could not update saved indicators', cause);
      });
    }, [savedScripts]);

    useEffect(() => {
      const ws = wsRef.current;
      if (!ws) return;
      try {
        const cell = ws.active;
        if (spotSymbol(cell.symbol) !== tab.symbol) {
          cell.setSymbol(chartSymbol(tab.symbol));
        }
        if (cell.timeframe !== tab.timeframe) {
          cell.setTimeframe(tab.timeframe);
        }
        if (ws.layout.id !== tab.layout) {
          ws.setLayout(tab.layout);
        }
      } catch {
        /* a destroyed workspace race */
      }
    }, [tab.symbol, tab.timeframe, tab.layout]);

    useEffect(() => {
      const ws = wsRef.current;
      if (!ws || !tab.pineScript || tab.pineScript === lastAppliedRef.current) return;
      try {
        applyToCells(ws, tab.pineScript, 'Screener Pine', tab.pineAll ?? false);
        lastAppliedRef.current = tab.pineScript;
      } catch (cause) {
        console.warn('[screener] could not apply the Pine script', cause);
      }
    }, [tab.pineScript, tab.pineAll]);

    useImperativeHandle(
      ref,
      () => ({
        applyScript(script: string, name: string, allCells: boolean) {
          const ws = wsRef.current;
          if (!ws) return 0;
          const count = applyToCells(ws, script, name, allCells);
          lastAppliedRef.current = script;
          return count;
        },
        addSavedIndicator(name: string, allCells: boolean) {
          const ws = wsRef.current;
          if (!ws) return 0;
          const cells = allCells ? ws.cells() : [ws.active];
          let count = 0;
          for (const cell of cells) {
            const index = cell
              .libraryRows()
              .findIndex((row) => row.category === 'My scripts' && row.name === name);
            if (index < 0) continue;
            cell.addFromLibrary(index);
            count += 1;
          }
          return count;
        },
        removeScript() {
          const ws = wsRef.current;
          if (!ws) return;
          for (const cell of ws.cells()) {
            const existing = cell.instances.find((item) => item.id === PINE_ID);
            existing?.handle?.remove();
          }
          lastAppliedRef.current = null;
        },
        setActiveSymbol(symbol: string) {
          wsRef.current?.active.setSymbol(chartSymbol(symbol));
        },
        setActiveTimeframe(timeframe: string) {
          wsRef.current?.active.setTimeframe(timeframe);
        },
        setLayout(layout: string) {
          wsRef.current?.setLayout(layout);
        },
        workspace() {
          return wsRef.current;
        },
      }),
      [],
    );

    return <div ref={hostRef} className="h-full w-full" />;
  },
);
