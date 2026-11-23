import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { sanitizeState, VelaWorkspace } from '@luxalgo/vela/workspace';
import type { ChartCell, WorkspaceStorage } from '@luxalgo/vela/workspace';
import type { Vela } from '@luxalgo/vela';
import type {
  DrawingPoint,
  DrawingStyle,
  DrawingText,
  DrawingTypeKey,
  SerializedDrawing,
} from '@luxalgo/vela';
import type { ScriptRun } from '@luxalgo/vela/plugin';
import {
  drawingTypes,
  getDrawingType,
  registerIcon,
  registerLegendAction,
  registerSymbolRanking,
} from '@luxalgo/vela/plugin';
import type {
  DrawingApplyResult,
  DrawingInfo,
  DrawingPatch,
  DrawingPointInput,
  DrawingRequest,
  DrawingToolInfo,
} from '../lib/ai/drawings';
import { validateDrawingRequest } from '../lib/ai/drawings';
import { PineEngine } from '../lib/pineVela/engine';
import type {
  AlertInputValues,
  ChartContext,
  IndicatorRow,
  PineInputValues,
  ScriptRunSummary,
  ThemeMode,
  VenueId,
  WorkspaceTab,
} from '../types';
import { chartSymbol, spotSymbol } from '../lib/binance';
import { toast } from 'sonner';
import type { LayoutApplyReport, LayoutCapture, LayoutPine } from '../lib/layouts';
import { scanAlertSites, scriptTitle } from '../lib/alertSites';
import { CreateAlertDialog, type AlertDraft } from './CreateAlertDialog';
import { pushStrategyRun, removeStrategyRun } from '../lib/strategyRuns';
import { timeframeMs } from '../lib/timeframe';
import { clearMaximizeBridge, setMaximizeBridge } from '../lib/velaMaximize';
import { setMountingVelaTab, setScreenshotTarget } from '../lib/velaPanels';
import {
  isSavedIndicatorInstance,
  savedIndicatorInstanceId,
  savedLibraryId,
} from '../lib/indicatorState';
import { PINE_ID, rememberScriptName } from '../lib/velaScripts';
import '../lib/velaScale';
import { velaDarkTheme, velaLightTheme } from '../lib/velaTheme';
import { stripChartDefaultsInState, stripWorkspaceDocument } from '../lib/velaChartConfig';
import { VENUE_CATALOG, VENUE_IDS } from '../venues/catalog';
import { SidecarVelaProvider } from '../venues/vela';

export interface SavedScript {
  id: string;
  name: string;
  source: string;
}

export interface ScriptApplyReport {
  /** Charts that took the new code. */
  count: number;
  /** Why a chart rejected it; its previous code keeps running. */
  errors: string[];
  /** The applied script's input values, ready to persist with the tab. */
  inputs?: PineInputValues;
  /** The applied script's property overrides, ready to persist with the tab. */
  props?: PineInputValues;
}

export interface VelaWorkspaceHandle {
  applyScript: (script: string, name: string, allCells: boolean) => Promise<ScriptApplyReport>;
  /** Snapshot the live workspace for a named layout. */
  captureLayout: () => LayoutCapture | null;
  /** Replace the workspace from a saved layout and reapply its script. */
  applyLayout: (layout: { state: unknown; pine?: LayoutPine }) => Promise<LayoutApplyReport>;
  /** Re-register the topbar action labels after the layout name changes. */
  refreshTopbar: () => void;
  addSavedIndicator: (script: SavedScript, allCells: boolean) => number;
  removeScript: () => void;
  indicatorRows: () => IndicatorRow[];
  addIndicatorRow: (index: number) => void;
  setActiveSymbol: (symbol: string) => void;
  setActiveTimeframe: (timeframe: string) => void;
  setLayout: (layout: string) => void;
  /** Active cell summary for the AI sidebar. */
  chartContext: () => ChartContext | null;
  /** PNG data URL of the active cell, or null when the renderer cannot export. */
  screenshot: () => string | null;
  /** Run a script on the active chart once and report the run; nothing stays on the chart. */
  runScript: (source: string) => Promise<ScriptRunSummary>;
  /** Every drawing type the chart can place, with its anchor schema. */
  drawingTools: () => DrawingToolInfo[];
  /** Native user drawings on the active cell. */
  listDrawings: () => DrawingInfo[];
  drawOnChart: (requests: DrawingRequest[]) => DrawingApplyResult;
  updateDrawing: (id: string, patch: DrawingPatch) => { ok: boolean; error?: string };
  removeDrawing: (id: string) => { ok: boolean };
  clearDrawings: () => { removed: number };
  workspace: () => VelaWorkspace | null;
}

interface Props {
  tab: WorkspaceTab;
  active: boolean;
  theme: ThemeMode;
  /** WebGL cap for this workspace; lower when several tabs stay mounted. */
  maxWebglCells: number;
  savedScripts: SavedScript[];
  /** Saved layout state for a fresh tab; ignored once the tab has its own doc. */
  layoutSeed?: unknown;
  onShowSource: (source: string, savedId?: string) => void;
  onAskAi: (source: string, savedId: string) => void;
  onIndicatorsChange?: () => void;
  /** The applied script's settings changed; persist them with the tab. */
  onPineSettings?: (settings: {
    inputs?: PineInputValues;
    props?: PineInputValues;
  }) => void;
  /** The applied Pine script left a chart on its own (legend ✕, object tree). */
  onPineRemoved: (tabId: string) => void;
  onMarketChange: (
    tabId: string,
    patch: { symbol?: string; timeframe?: string; layout?: string },
  ) => void;
}

const SOURCE_ACTION_ID = 'screener-show-source';
const ASK_AI_ACTION_ID = 'screener-ask-ai';

let showSourceHandler: ((source: string, savedId?: string) => void) | null = null;
const askAiHandlers = new Map<string, (source: string, savedId: string) => void>();

function legendTabId(ctx: { host: HTMLElement }): string {
  return ctx.host.closest('[data-tab-id]')?.getAttribute('data-tab-id') ?? '';
}

/** Vela's anchor schema for a drawing type: how many points it needs and their roles. */
function drawingSchema(type: string): { min: number; max: number; slots: string[] } | null {
  const meta = getDrawingType(type);
  if (!meta) return null;
  const schema = meta.create({ paneId: 'probe', anchors: [] }).anchorSchema();
  return { min: schema.min, max: schema.max, slots: schema.slots.map((slot) => slot.role) };
}

function drawingTextOf(value: string): DrawingText {
  return { value, size: 'normal', hAlign: 'center', vAlign: 'center' };
}

function drawingAnchors(points: readonly DrawingPointInput[]): DrawingPoint[] {
  return points.map((point) => ({ time: point.time, price: point.price }));
}

function drawingInfoOf(drawing: SerializedDrawing): DrawingInfo {
  return {
    id: drawing.id,
    type: drawing.type,
    anchors: drawingAnchors(drawing.anchors),
    text: drawing.text?.value ?? null,
    locked: drawing.locked,
    visible: drawing.visible,
  };
}

registerIcon(
  'screener-source',
  '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
);
registerIcon(
  'screener-ai',
  '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5 9.7 6.3 14.5 8l-4.8 1.7L8 14.5 6.3 9.7 1.5 8l4.8-1.7Z"/><path d="M12.8 1.7v2.6M11.5 3h2.6"/></svg>',
);

// The picker's pool is built venue by venue; sort it by ticker so exchanges are
// interleaved rather than grouped. A registered ranking also retires the pinned
// majors head, so the opening screen is the alphabetical list.
registerSymbolRanking((symbols) =>
  [...symbols].sort((a, b) => {
    const byTicker = a.ticker.localeCompare(b.ticker, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    if (byTicker !== 0) return byTicker;
    return (a.provider ?? '').localeCompare(b.provider ?? '');
  }),
);

registerLegendAction({
  id: SOURCE_ACTION_ID,
  icon: 'screener-source',
  tooltip: 'Show source code',
  when: (indicator) => indicator.source !== undefined,
  run: (_ctx, indicator) => {
    if (indicator.source) {
      showSourceHandler?.(indicator.source, savedLibraryId(indicator.id));
    }
  },
});

registerLegendAction({
  id: ASK_AI_ACTION_ID,
  icon: 'screener-ai',
  tooltip: 'Ask AI about this script',
  order: -10,
  when: (indicator) =>
    indicator.source !== undefined && indicator.language === 'pine',
  run: (ctx, indicator) => {
    if (!indicator.source) return;
    askAiHandlers.get(legendTabId(ctx))?.(
      indicator.source,
      savedLibraryId(indicator.id),
    );
  },
});

type CreateAlertHandler = (
  chart: Vela,
  indicator: { id: string; title: string; source?: string },
) => void;

const createAlertHandlers = new Map<string, CreateAlertHandler>();

registerLegendAction({
  id: 'screener-create-alert',
  icon: 'bell',
  tooltip: 'Create alert',
  order: -20,
  when: (indicator) =>
    indicator.source !== undefined && indicator.language === 'pine',
  run: (ctx, indicator) => {
    if (indicator.source) createAlertHandlers.get(legendTabId(ctx))?.(ctx.chart, indicator);
  },
});


/**
 * Boot a tab from a saved layout only while it has no document of its own.
 * After the first autosave (or on reload) the tab's document wins, so edits are
 * never clobbered by the seed.
 */
function seededStorage(key: string, seed: unknown): WorkspaceStorage {
  let seeded = false;
  return {
    get(requested) {
      if (requested !== key) return null;
      try {
        const existing = localStorage.getItem(requested);
        if (existing) return stripWorkspaceDocument(existing);
      } catch {
        return null;
      }
      if (seeded) return null;
      seeded = true;
      if (seed === undefined) return null;
      try {
        return stripWorkspaceDocument(JSON.stringify(seed));
      } catch {
        return null;
      }
    },
    set(requested, value) {
      try {
        localStorage.setItem(requested, stripWorkspaceDocument(value));
      } catch {
        /* a full store keeps the workspace in memory */
      }
    },
    remove(requested) {
      try {
        localStorage.removeItem(requested);
      } catch {
        /* ignore */
      }
    },
  };
}

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

function primitiveValuesOf(
  values: Record<string, unknown> | undefined,
): PineInputValues | undefined {
  if (!values) return undefined;
  const out: PineInputValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The applied script's inputs and props, ready to persist with the tab. */
function appliedSettingsOf(
  handle:
    | { inputValues(): Record<string, unknown>; propValues(): Record<string, unknown> }
    | null
    | undefined,
): { inputs?: PineInputValues; props?: PineInputValues } | undefined {
  if (!handle) return undefined;
  const inputs = primitiveValuesOf(handle.inputValues());
  const props = primitiveValuesOf(handle.propValues());
  if (!inputs && !props) return undefined;
  return { ...(inputs ? { inputs } : {}), ...(props ? { props } : {}) };
}

async function applyToCells(
  ws: VelaWorkspace,
  script: string,
  name: string,
  allCells: boolean,
  inputs?: PineInputValues,
  props?: PineInputValues,
): Promise<ScriptApplyReport> {
  const cells = allCells ? ws.cells() : [ws.active];
  let count = 0;
  let applied: { inputs?: PineInputValues; props?: PineInputValues } | undefined;
  const errors: string[] = [];
  for (const cell of cells) {
    try {
      const existing = cell.instances.find((item) => item.id === PINE_ID);
      if (existing?.handle) {
        // Same handle, same legend row, same inputs and props. Vela restores the
        // previous code when the new one fails to compile or run.
        const result = await existing.handle.updateCode(script);
        if (result.ok) {
          if (inputs) existing.handle.setInputs(inputs);
          if (props) existing.handle.setProps(props);
          applied = appliedSettingsOf(existing.handle) ?? applied;
          count += 1;
        } else errors.push(result.error?.message ?? 'The chart rejected the script');
      } else {
        cell.addExternalIndicator({
          id: PINE_ID,
          name,
          script,
          language: 'pine',
          ...(inputs ? { inputs } : {}),
          ...(props ? { props } : {}),
        });
        applied =
          appliedSettingsOf(cell.instances.find((item) => item.id === PINE_ID)?.handle) ??
          applied;
        count += 1;
      }
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return { count, errors, ...(applied ?? {}) };
}

/** Model-facing vars: primitives only, bounded. Objects and arrays stay out. */
function scalarVars(vars: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (Object.keys(out).length >= 40) break;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      out[key] = String(value).slice(0, 200);
    }
  }
  return out;
}

/** Unique probe ids: a timed-out run can stay live and block the next one. */
let debugSeq = 0;

const HISTORY_STEP = 500;
const HISTORY_MAX = 100_000;
const INITIAL_DEPTH = 500;
const HISTORY_EDGE_BARS = 8;
const HISTORY_WAIT_MS = 30_000;

type CellChart = ChartCell['chart'];

interface CellHistory {
  exhausted: boolean;
  busy: boolean;
  pendingDepth: number;
  /** Visible bar count, so only a zoom change marks the workspace dirty. */
  scale: number | null;
  status: HTMLElement;
  cancelWait: (() => void) | null;
  errorTimer: ReturnType<typeof setTimeout> | null;
}

function barMsOf(chart: CellChart): number {
  try {
    return timeframeMs(chart.market.timeframe ?? '15');
  } catch {
    return 0;
  }
}

/** Loaded bars in the cell, derived from the replay bounds. */
function chartBarCount(chart: CellChart): number {
  try {
    const bounds = chart.replay.bounds;
    const barMs = barMsOf(chart);
    if (!bounds || barMs <= 0) return 0;
    return Math.max(0, Math.round((bounds.last - bounds.first) / barMs) + 1);
  } catch {
    return 0;
  }
}

function maxBarsBackOf(source: string): number | null {
  const match = /max_bars_back\s*=\s*(\d+)/.exec(source);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function stackOf(error: Error | null | undefined): string | null {
  return error?.stack ? error.stack.slice(0, 4000) : null;
}

function methodOf(error: unknown): string | null {
  const method = (error as { method?: unknown } | null)?.method;
  return typeof method === 'string' ? method : null;
}

function setHistoryStatus(
  state: CellHistory,
  text: string | null,
  kind: 'loading' | 'error' = 'loading',
): void {
  if (state.errorTimer) {
    clearTimeout(state.errorTimer);
    state.errorTimer = null;
  }
  state.status.textContent = text ?? '';
  state.status.dataset.kind = kind;
  state.status.hidden = !text;
}

function flashHistoryError(state: CellHistory, text: string): void {
  setHistoryStatus(state, text, 'error');
  state.errorTimer = setTimeout(() => {
    state.errorTimer = null;
    if (!state.busy) setHistoryStatus(state, null);
  }, 3_000);
}

/** Depth-only reloads reuse Vela's resolved history promise; wait for the event. */
function nextHistoryComplete(chart: CellChart): {
  promise: Promise<void>;
  cancel: () => void;
} {
  let finish: (() => void) | null = null;
  let off: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<void>((resolve) => {
    finish = () => {
      if (!finish) return;
      finish = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      off?.();
      off = null;
      resolve();
    };
    off = chart.on('history:complete', () => finish?.());
    timer = setTimeout(() => finish?.(), HISTORY_WAIT_MS);
  });
  return {
    promise,
    cancel: () => finish?.(),
  };
}

function atLoadedEdge(chart: CellChart): boolean {
  const range = chart.getVisibleRange();
  const first = chart.replay.bounds?.first;
  const barMs = barMsOf(chart);
  if (!range || first == null || barMs <= 0) return false;
  return range.from <= first + barMs * HISTORY_EDGE_BARS;
}

function extendHistory(chart: CellChart, state: CellHistory, requested?: number): void {
  if (state.exhausted) return;
  // Replay walks the history already loaded; a depth reload would reframe the
  // chart and leave the replay cursor behind.
  try {
    if (chart.replay.state.active) return;
  } catch {
    // A chart between teardown and destroy; nothing to extend.
  }
  const current = chart.market.bars ?? INITIAL_DEPTH;
  const target = Math.min(requested ?? current + HISTORY_STEP, HISTORY_MAX);
  if (target <= current) return;
  if (state.busy) {
    state.pendingDepth = Math.max(state.pendingDepth, target);
    return;
  }
  state.busy = true;
  setHistoryStatus(state, 'Loading older data…');
  const wait = nextHistoryComplete(chart);
  state.cancelWait = wait.cancel;
  void chart
    .setMarket({ bars: target })
    .then(() => wait.promise)
    .catch(() => {
      if (state.cancelWait === wait.cancel) state.cancelWait = null;
      flashHistoryError(state, 'Could not load older data');
    })
    .finally(() => {
      if (state.cancelWait === wait.cancel) state.cancelWait = null;
      state.busy = false;
      const pending = state.pendingDepth;
      state.pendingDepth = 0;
      if (!state.errorTimer) setHistoryStatus(state, null);
      if (!state.errorTimer && pending > (chart.market.bars ?? INITIAL_DEPTH)) {
        extendHistory(chart, state, pending);
      }
    });
}

/**
 * Vela loads the depth it was asked for and never fetches more on pan, zoom or
 * resize. Extend the cell's depth when the viewport reaches the oldest loaded
 * bar, or when a wider cell leaves its loaded series short of the window (Vela
 * keeps the bar spacing across a resize, so a 0.5 px/bar view leaves the extra
 * width empty until the missing history arrives).
 */
function attachHistoryScroll(
  ws: VelaWorkspace,
  onIndicatorsChange: () => void,
  onPineRemoved: () => void,
  onStrategyRun: (cellId: string, id: string, run: ScriptRun | null) => void,
  onPineSettings: (settings: {
    inputs?: PineInputValues;
    props?: PineInputValues;
  }) => void,
): () => void {
  const cells = new Map<string, CellHistory>();
  const cleanups = new Map<string, () => void>();
  const subscriptions: Array<() => void> = [];

  const attach = (cell: ChartCell): void => {
    const chart = cell.chart;
    const status = document.createElement('div');
    status.className = 'screener-history-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    cell.host.appendChild(status);

    const state: CellHistory = {
      exhausted: false,
      busy: false,
      pendingDepth: 0,
      scale: null,
      status,
      cancelWait: null,
      errorTimer: null,
    };
    cells.set(cell.id, state);
    if (!chart.getVisibleRange()) setHistoryStatus(state, 'Loading chart…');

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0 || !atLoadedEdge(chart)) return;
      extendHistory(chart, state);
    };
    cell.host.addEventListener('wheel', onWheel, { passive: true, capture: true });

    // Vela keeps the bar spacing when the cell grows, so the extra width stays
    // empty until enough history exists to fill it. Load that history at the
    // same scale - never resize or re-frame the viewport.
    let lastWidth = cell.host.getBoundingClientRect().width;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              resizeTimer = null;
              const width = cell.host.getBoundingClientRect().width;
              if (lastWidth > 0 && width > lastWidth * 1.05 && cell.host.style.visibility !== 'hidden') {
                const depth = chart.market.bars ?? INITIAL_DEPTH;
                if (atLoadedEdge(chart)) {
                  const target = Math.ceil((depth * width * 1.15) / lastWidth) + 50;
                  extendHistory(chart, state, Math.min(target, HISTORY_MAX));
                }
              }
              lastWidth = width;
            }, 150);
          });
    observer?.observe(cell.host);

    const offs: Array<() => void> = [
      () => cell.host.removeEventListener('wheel', onWheel, true),
      chart.on('load:start', () => setHistoryStatus(state, 'Loading chart…')),
      chart.on('load:end', ({ bars }) => {
        if (state.busy) return;
        if (bars === 0) {
          flashHistoryError(state, 'Could not load chart');
          return;
        }
        setHistoryStatus(state, null);
      }),
      chart.on('history:progress', ({ loaded, target }) => {
        if (!state.busy) return;
        setHistoryStatus(
          state,
          `Loading older data… ${loaded.toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`,
        );
      }),
      chart.on('history:complete', ({ reason }) => {
        state.exhausted = reason === 'genesis';
        if (!state.busy) {
          setHistoryStatus(state, null);
        } else if (reason === 'aborted') {
          flashHistoryError(state, 'Could not load older data');
        }
      }),
      chart.on('market:changed', () => {
        state.cancelWait?.();
        state.cancelWait = null;
        state.pendingDepth = 0;
        state.exhausted = false;
        state.busy = false;
        // Keep the cell's depth across a symbol/timeframe switch: Vela keeps the
        // bar spacing, so resetting the depth to the default would leave the new
        // series too short to fill the zoomed-out window.
      }),
      chart.on('viewport:changed', ({ from }) => {
        // Only a zoom change is persisted: panning keeps the same bar count and
        // must not rewrite the whole workspace document.
        const range = chart.getVisibleRange();
        const barMs = barMsOf(chart);
        if (range && barMs > 0) {
          const bars = Math.max(1, Math.round((range.to - range.from) / barMs) + 1);
          if (state.scale === null) state.scale = bars;
          else if (bars !== state.scale) {
            state.scale = bars;
            ws.context().stateChanged();
          }
        }
        if (state.exhausted || state.busy) return;
        const first = chart.replay.bounds?.first;
        if (first == null || from > first + barMs * HISTORY_EDGE_BARS) return;
        extendHistory(chart, state);
      }),
      chart.on('indicator:added', () => {
        onIndicatorsChange();
        // Native adds and removes only reach the workspace through the async
        // catalog refresh; the app owns the picker, so force the save itself.
        ws.context().stateChanged();
      }),
      chart.on('indicator:removed', ({ id }) => {
        onIndicatorsChange();
        ws.context().stateChanged();
        if (id === PINE_ID) onPineRemoved();
        onStrategyRun(cell.id, id, null);
      }),
      chart.on('indicator:inputs', ({ id }) => {
        if (id !== PINE_ID) return;
        onPineSettings(
          appliedSettingsOf(cell.instances.find((item) => item.id === PINE_ID)?.handle) ?? {},
        );
      }),
      chart.on('script:run', (run) => {
        onStrategyRun(cell.id, run.id, run.kind === 'strategy' ? run : null);
      }),
    ];

    cleanups.set(cell.id, () => {
      state.cancelWait?.();
      if (state.errorTimer) clearTimeout(state.errorTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      observer?.disconnect();
      for (const off of offs) off();
      status.remove();
    });
  };

  for (const cell of ws.cells()) attach(cell);
  subscriptions.push(
    ws.on('cell:created', ({ id }) => {
      const cell = ws.cells().find((item) => item.id === id);
      if (cell) attach(cell);
    }),
    ws.on('cell:destroyed', ({ id }) => {
      cells.delete(id);
      cleanups.get(id)?.();
      cleanups.delete(id);
    }),
  );

  return () => {
    for (const off of subscriptions) off();
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}

export const VelaWorkspaceHost = forwardRef<VelaWorkspaceHandle, Props>(
  function VelaWorkspaceHost(
    {
      tab,
      active,
      theme,
      maxWebglCells,
      savedScripts,
      layoutSeed,
      onShowSource,
      onAskAi,
      onIndicatorsChange,
      onPineSettings,
      onPineRemoved,
      onMarketChange,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<VelaWorkspace | null>(null);
    const lastAppliedRef = useRef<string | null>(null);
    const pineSwapRef = useRef(false);
    const onMarketChangeRef = useRef(onMarketChange);
    onMarketChangeRef.current = onMarketChange;
    const onShowSourceRef = useRef(onShowSource);
    onShowSourceRef.current = onShowSource;
    const onAskAiRef = useRef(onAskAi);
    onAskAiRef.current = onAskAi;
    const onIndicatorsChangeRef = useRef(onIndicatorsChange);
    onIndicatorsChangeRef.current = onIndicatorsChange;
    const onPineSettingsRef = useRef(onPineSettings);
    onPineSettingsRef.current = onPineSettings;
    const pineSettingsRef = useRef({ inputs: tab.pineInputs, props: tab.pineProps });
    pineSettingsRef.current = { inputs: tab.pineInputs, props: tab.pineProps };
    const onPineRemovedRef = useRef(onPineRemoved);
    onPineRemovedRef.current = onPineRemoved;
    const savedScriptsRef = useRef(savedScripts);
    savedScriptsRef.current = savedScripts;
    const activeRef = useRef(active);
    activeRef.current = active;
    const syncMaximizeRef = useRef<() => void>(() => {});
    const [alertDraft, setAlertDraft] = useState<AlertDraft | null>(null);

    useEffect(() => {
      showSourceHandler = (source, savedId) =>
        onShowSourceRef.current(source, savedId);
      askAiHandlers.set(tab.id, (source, savedId) =>
        onAskAiRef.current(source, savedId),
      );
      createAlertHandlers.set(tab.id, (chart, indicator) => {
        const source = indicator.source;
        if (!source) return;
        if (/chart\.(?:left|right)_visible_bar_time/.test(source)) {
          toast.warning('Viewport functions are not available in alerts');
          return;
        }
        const scan = scanAlertSites(source);
        if (scan.conditions.length === 0 && !scan.hasAlert) {
          toast.warning('This script has no alertcondition or alert() calls');
          return;
        }
        const ws = wsRef.current;
        const cell = ws?.cells().find((item) => item.chart === chart) ?? ws?.active;
        if (!cell) return;
        const provider = (chart as Vela).market?.provider;
        const cellProvider = (cell.chart as Vela).market?.provider;
        const prefix = cell.symbol.includes(':') ? cell.symbol.split(':')[0] : '';
        const venue = (provider || cellProvider || prefix || 'binance').toLowerCase();
        if (!VENUE_IDS.includes(venue as VenueId)) {
          toast.warning('The chart venue is not available for alerts');
          return;
        }
        const symbol = cell.symbol.replace(/^[^:]+:/, '');
        const velaSymbol = cell.symbol.includes(':')
          ? cell.symbol
          : `${venue.toUpperCase()}:${cell.symbol}`;
        const handle = cell.chart.indicators().find((item) => item.id === indicator.id);
        const inputs: AlertInputValues = {};
        for (const [key, value] of Object.entries(handle?.inputValues() ?? {})) {
          if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
            inputs[key] = value;
          }
        }
        const name = scriptTitle(source) ?? indicator.title;
        setAlertDraft({
          source,
          indicatorTitle: name,
          symbol,
          timeframe: cell.requestedTimeframe,
          venue: venue as VenueId,
          velaSymbol,
          sites: scan.conditions,
          hasAlert: scan.hasAlert,
          untitled: scan.untitled,
          inputs,
        });
      });
      return () => {
        showSourceHandler = null;
        askAiHandlers.delete(tab.id);
        createAlertHandlers.delete(tab.id);
      };
    }, [tab.id]);

    /** The applied script left the chart on its own: forget it on the tab so a
     *  reload, a layout save or a layout switch cannot bring it back. */
    const dropStoredPine = () => {
      if (pineSwapRef.current) return;
      const ws = wsRef.current;
      if (!ws) return;
      pineSwapRef.current = true;
      try {
        for (const cell of ws.cells()) {
          cell.instances.find((item) => item.id === PINE_ID)?.handle?.remove();
        }
      } finally {
        pineSwapRef.current = false;
      }
      lastAppliedRef.current = null;
      onPineRemovedRef.current(tab.id);
    };

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      lastAppliedRef.current = null;
      const wantedLayout = tab.layout || '1';
      // Do not seed a wider grid and collapse it: destroying the extra cell calls
      // feed.destroy(), which cancels the surviving cell's parked symbol wait while
      // the provider index is still settling. The tab would open blank until its
      // symbol or layout changed. `cells` still carries the alt/extra seeds Vela
      // hydrates from when the user expands later.
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
      const persistKey = `screener-v2:ws:${tab.id}`;
      const ws = (() => {
        setMountingVelaTab(tab.id);
        try {
          return new VelaWorkspace(host, {
            layout: wantedLayout,
            symbol: chartSymbol(tab.symbol),
            timeframe: tab.timeframe,
            cells: cellSeeds,
            providers: Object.fromEntries(
              VENUE_CATALOG.map((venue) => [
                venue.id,
                () => new SidecarVelaProvider(venue.id, venue.label),
              ]),
            ),
            engines: {
              pine: () =>
                new PineEngine({
                  onWarning: (message) => toast.warning(message, { duration: 8000 }),
                }),
            },
            live: true,
            theme: theme === 'dark' ? velaDarkTheme : velaLightTheme,
            formatters: {
              price: (_value, ctx) => ctx.fallback().replace(/,/g, '\u00a0'),
            },
            timezone: 'UTC',
            persist: persistKey,
            storage: seededStorage(persistKey, layoutSeed),
            drawingToolbar: true,
            sidebar: {
              top: [
                'screener-screenshot',
                '|',
                'screener',
                'pine',
                'library',
                'orderflow',
                '|',
                'alerts',
              ],
            },
            maxWebglCells,
          });
        } finally {
          setMountingVelaTab(null);
        }
      })();
      wsRef.current = ws;
      const detachHistory = attachHistoryScroll(
        ws,
        () => onIndicatorsChangeRef.current?.(),
        dropStoredPine,
        (cellId, id, run) => {
          if (run) pushStrategyRun(tab.id, cellId, run);
          else removeStrategyRun(tab.id, cellId, id);
        },
        (settings) => onPineSettingsRef.current?.(settings),
      );
      // The restored document already carries the user's active cell; only fall
      // back to the tab's symbol when the document left a different one active.
      const wantedSymbol = chartSymbol(tab.symbol);
      if (ws.active?.symbol !== wantedSymbol) {
        const matchingCell = ws.cells().find((cell) => cell.symbol === wantedSymbol);
        if (matchingCell) ws.setActiveCell(matchingCell.id);
      }
      if (tab.pineScript) {
        try {
          void applyToCells(
            ws,
            tab.pineScript,
            tab.pineName ?? 'Screener Pine',
            tab.pineAll ?? false,
            tab.pineInputs,
            tab.pineProps,
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
          const timeframe = cell.requestedTimeframe;
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
        if (wsRef.current !== ws || !activeRef.current) return;
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
      syncMaximizeRef.current = syncMaximize;
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
        if (activeRef.current) clearMaximizeBridge();
        detachHistory();
        ws.destroy();
        if (wsRef.current === ws) wsRef.current = null;
      };
      // One host per visited tab; this effect owns that workspace until the tab
      // closes. Theme and prop sync are separate.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.id]);

    useEffect(() => {
      setScreenshotTarget(tab.id, () => wsRef.current?.downloadScreenshot());
      return () => setScreenshotTarget(tab.id, null);
    }, [tab.id]);

    useEffect(() => {
      const ws = wsRef.current;
      if (!ws) return;
      ws.setTheme(theme === 'dark' ? velaDarkTheme : velaLightTheme);
    }, [theme]);

    useEffect(() => {
      if (active) syncMaximizeRef.current();
    }, [active]);

    useEffect(() => {
      const ws = wsRef.current;
      if (!ws) return;
      try {
        const cell = ws.active;
        if (spotSymbol(cell.symbol) !== tab.symbol) {
          cell.setSymbol(chartSymbol(tab.symbol));
        }
        if (cell.requestedTimeframe !== tab.timeframe) {
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
        const settings = pineSettingsRef.current;
        void applyToCells(
          ws,
          tab.pineScript,
          'Screener Pine',
          tab.pineAll ?? false,
          settings.inputs,
          settings.props,
        );
        lastAppliedRef.current = tab.pineScript;
      } catch (cause) {
        console.warn('[screener] could not apply the Pine script', cause);
      }
    }, [tab.pineScript, tab.pineAll]);

    useImperativeHandle(
      ref,
      () => ({
        async applyScript(script: string, name: string, allCells: boolean) {
          const ws = wsRef.current;
          if (!ws) return { count: 0, errors: ['The chart is not ready yet'] };
          const report = await applyToCells(ws, script, name, allCells);
          if (report.count > 0) lastAppliedRef.current = script;
          return report;
        },
        captureLayout() {
          const ws = wsRef.current;
          if (!ws) return null;
          try {
            const cell = ws.active;
            const other = ws.cells().find((item) => item.id !== cell.id);
            // Shared preference sets are the user's, not the layout's: leaving
            // them out keeps a layout from rewriting the drawing/timeframe stars.
            const {
              favorites: _favorites,
              timeframeFavorites: _timeframeFavorites,
              ...state
            } = stripChartDefaultsInState(ws.getState());
            return {
              state,
              layout: ws.layout.id,
              symbol: spotSymbol(cell.symbol),
              timeframe: cell.requestedTimeframe,
              altSymbol: other ? spotSymbol(other.symbol) : tab.altSymbol,
            };
          } catch (cause) {
            console.warn('[screener] could not capture the layout', cause);
            return null;
          }
        },
        async applyLayout(layout: { state: unknown; pine?: LayoutPine }) {
          const ws = wsRef.current;
          const empty: LayoutApplyReport = {
            ok: false,
            error: 'The chart is not ready yet',
            symbol: tab.symbol,
            timeframe: tab.timeframe,
            layout: tab.layout,
            altSymbol: tab.altSymbol,
            cells: 0,
          };
          if (!ws) return empty;
          const state = sanitizeState(layout.state);
          if (!state) return { ...empty, error: 'This layout cannot be read' };
          try {
            ws.applyState(stripChartDefaultsInState(state));
          } catch (cause) {
            return { ...empty, error: cause instanceof Error ? cause.message : String(cause) };
          }
          // The applied script is app-owned and absent from the document; drop
          // the previous one, then reapply the snapshot's script if it has one.
          // The removal is a swap, not a user delete: keep the tab's stored
          // script until the caller writes the snapshot's value.
          pineSwapRef.current = true;
          try {
            for (const cell of ws.cells()) {
              cell.instances.find((item) => item.id === PINE_ID)?.handle?.remove();
            }
          } finally {
            pineSwapRef.current = false;
          }
          lastAppliedRef.current = null;
          let pineError: string | null = null;
          if (layout.pine) {
            const report = await applyToCells(
              ws,
              layout.pine.script,
              layout.pine.name,
              layout.pine.all,
              layout.pine.inputs,
              layout.pine.props,
            );
            if (report.count > 0) lastAppliedRef.current = layout.pine.script;
            pineError = report.errors[0] ?? null;
          }
          try {
            const cell = ws.active;
            const other = ws.cells().find((item) => item.id !== cell.id);
            return {
              ok: pineError === null,
              error: pineError,
              symbol: spotSymbol(cell.symbol),
              timeframe: cell.requestedTimeframe,
              layout: ws.layout.id,
              altSymbol: other ? spotSymbol(other.symbol) : '',
              cells: ws.cells().length,
            };
          } catch (cause) {
            return { ...empty, error: cause instanceof Error ? cause.message : String(cause) };
          }
        },
        refreshTopbar() {
          wsRef.current?.refreshActions();
        },
        addSavedIndicator(script: SavedScript, allCells: boolean) {
          const ws = wsRef.current;
          if (!ws) return 0;
          const cells = allCells ? ws.cells() : [ws.active];
          const id = savedIndicatorInstanceId(script.id);
          let count = 0;
          rememberScriptName(id, script.name);
          for (const cell of cells) {
            cell.addExternalIndicator({
              id,
              name: script.name,
              script: script.source,
              language: 'pine',
            });
            count += 1;
          }
          return count;
        },
        removeScript() {
          const ws = wsRef.current;
          if (!ws) return;
          pineSwapRef.current = true;
          try {
            for (const cell of ws.cells()) {
              const existing = cell.instances.find((item) => item.id === PINE_ID);
              existing?.handle?.remove();
            }
          } finally {
            pineSwapRef.current = false;
          }
          lastAppliedRef.current = null;
        },
        indicatorRows() {
          const cell = wsRef.current?.active;
          if (!cell) return [];
          const onChart = new Set(cell.onChartRows().map((row) => row.name));
          const onChartNatives = new Set(
            cell
              .onChartRows()
              .map((row) => row.nativeType)
              .filter((type): type is string => Boolean(type)),
          );
          const scripts = savedScriptsRef.current.map((script) => ({
            index: -1,
            savedId: script.id,
            name: script.name,
            native: false,
            category: 'My scripts',
            language: 'pine',
            nativeType: null,
            beta: false,
            present:
              cell.instances.some(
                (instance) =>
                  typeof instance.id === 'string' &&
                  isSavedIndicatorInstance(instance.id, script.id),
              ) || onChart.has(script.name),
          }));
          const natives = cell.libraryRows().flatMap((row, index) =>
            row.native === true
              ? [
                  {
                    index,
                    savedId: null,
                    name: row.name,
                    native: true,
                    category: row.category ?? null,
                    language: row.language ?? null,
                    nativeType: row.nativeType ?? null,
                    beta: row.beta === true,
                    present: row.nativeType
                      ? onChartNatives.has(row.nativeType)
                      : onChart.has(row.name),
                  },
                ]
              : [],
          );
          return [...scripts, ...natives];
        },
        addIndicatorRow(index: number) {
          const cell = wsRef.current?.active;
          if (!cell) return;
          const row = cell.libraryRows()[index];
          if (row?.native) cell.addFromLibrary(index);
        },
        setActiveSymbol(symbol: string) {
          const cell = wsRef.current?.active;
          if (!cell) return;
          const next = chartSymbol(symbol);
          // Keep the current depth: the cell keeps its zoom across a symbol
          // switch, so the new series must load the same number of bars.
          cell.setSymbol(next);
        },
        setActiveTimeframe(timeframe: string) {
          wsRef.current?.active.setTimeframe(timeframe);
        },
        setLayout(layout: string) {
          wsRef.current?.setLayout(layout);
        },
        chartContext() {
          const ws = wsRef.current;
          const cell = ws?.active;
          if (!ws || !cell) return null;
          const range = cell.chart.getVisibleRange();
          const pine = cell.instances.find((item) => item.id === 'screener-pine');
          return {
            symbol: cell.symbol,
            timeframe: cell.timeframe,
            layout: ws.layout.id,
            indicators: cell.chart.indicators().map((handle) => handle.title),
            appliedPine: pine
              ? { name: pine.handle?.title ?? 'Screener Pine', chars: pine.handle?.source?.length ?? 0 }
              : null,
            cells: ws.cells().length,
            bars: chartBarCount(cell.chart),
            visible: range ? { from: range.from, to: range.to } : null,
            drawings: cell.chart.drawings
              .all()
              .slice(-20)
              .map((drawing) => ({
                id: drawing.id,
                type: drawing.type,
                text: drawing.text?.value ?? null,
              })),
          };
        },
        drawingTools() {
          return drawingTypes().map((meta) => {
            const schema = drawingSchema(meta.type);
            return {
              type: meta.type,
              group: meta.group,
              label: meta.label,
              min: schema?.min ?? 0,
              max: schema?.max ?? 0,
              slots: schema?.slots ?? [],
            };
          });
        },
        listDrawings() {
          const cell = wsRef.current?.active;
          return (cell?.chart.drawings.all() ?? []).map(drawingInfoOf);
        },
        drawOnChart(requests: DrawingRequest[]): DrawingApplyResult {
          const cell = wsRef.current?.active;
          if (!cell) return { created: [], errors: ['No chart is open'] };
          const created: string[] = [];
          const errors: string[] = [];
          for (const request of requests) {
            const error = validateDrawingRequest(request, drawingSchema(request.type));
            if (error) {
              errors.push(error);
              continue;
            }
            const drawing = cell.chart.drawings.add(request.type as DrawingTypeKey, {
              anchors: drawingAnchors(request.points),
              ...(request.text ? { text: drawingTextOf(request.text) } : {}),
              ...(request.style
                ? { style: request.style as Partial<DrawingStyle> }
                : {}),
              ...(request.props ? { props: request.props } : {}),
            });
            if (drawing) created.push(drawing.id);
            else errors.push(`The chart rejected ${request.type}`);
          }
          return { created, errors };
        },
        updateDrawing(id: string, patch: DrawingPatch) {
          const cell = wsRef.current?.active;
          if (!cell) return { ok: false, error: 'No chart is open' };
          const current = cell.chart.drawings.all().find((drawing) => drawing.id === id);
          if (!current) return { ok: false, error: `No drawing "${id}"` };
          const next: Partial<SerializedDrawing> = {};
          if (patch.points) {
            const error = validateDrawingRequest(
              { type: current.type, points: patch.points },
              drawingSchema(current.type),
            );
            if (error) return { ok: false, error };
            next.anchors = drawingAnchors(patch.points);
          }
          if (patch.text !== undefined) next.text = drawingTextOf(patch.text);
          if (patch.style) {
            next.style = { ...current.style, ...(patch.style as Partial<DrawingStyle>) };
          }
          if (patch.props) next.props = { ...current.props, ...patch.props };
          if (Object.keys(next).length === 0) return { ok: false, error: 'Nothing to update' };
          cell.chart.drawings.update(id, next);
          return { ok: true };
        },
        removeDrawing(id: string) {
          const cell = wsRef.current?.active;
          if (!cell) return { ok: false };
          if (!cell.chart.drawings.all().some((drawing) => drawing.id === id)) {
            return { ok: false };
          }
          cell.chart.drawings.remove(id);
          return { ok: true };
        },
        clearDrawings() {
          const cell = wsRef.current?.active;
          if (!cell) return { removed: 0 };
          const ids = cell.chart.drawings.all().map((drawing) => drawing.id);
          if (ids.length === 0) return { removed: 0 };
          cell.chart.drawings.removeMany(ids);
          return { removed: ids.length };
        },
        screenshot() {
          return wsRef.current?.active.chart.renderer.screenshot() ?? null;
        },
        async runScript(source: string): Promise<ScriptRunSummary> {
          const cell = wsRef.current?.active;
          const bars = cell ? chartBarCount(cell.chart) : 0;
          const maxBarsBack = maxBarsBackOf(source);
          const base: ScriptRunSummary = {
            ok: false,
            error: null,
            stack: null,
            errorName: null,
            method: null,
            complete: false,
            warnings: [],
            plots: {},
            vars: {},
            strategy: false,
            bars,
            maxBarsBack,
            symbol: cell?.symbol ?? '',
            timeframe: cell?.timeframe ?? '',
            logs: [],
          };
          if (!cell) return { ...base, error: 'No active chart' };
          // A chart without history never emits its first run; do not hang the
          // model on it, and drop the probe we already mounted.
          let timer: number | undefined;
          const timedOut = new Promise<null>((resolve) => {
            timer = window.setTimeout(() => resolve(null), 15_000);
          });
          const debugId = `ai-debug-${++debugSeq}`;
          const result = await Promise.race([
            cell.chart.runScript(source, { id: debugId }),
            timedOut,
          ]);
          window.clearTimeout(timer);
          if (!result) {
            cell.chart.indicators().find((handle) => handle.id === debugId)?.remove();
            return {
              ...base,
              error: 'The chart did not finish the run within 15 seconds; check that it has data.',
            };
          }
          let run = result.run;
          // The first run paints before request.security lower/foreign series
          // arrive. Wait briefly for that follow-up so the summary reports the
          // final values instead of the provisional pass.
          if (run && /request\.security/.test(source)) {
            const first = run;
            // Collect follow-ups for a short window; the last one carries the
            // lower/foreign series, while a live tick may arrive first.
            run = await new Promise((resolve) => {
              let latest = first;
              const off = result.onUpdate((next) => {
                latest = next;
              });
              window.setTimeout(() => {
                off();
                resolve(latest);
              }, 1500);
            });
          }
          const error = result.error;
          const summary: ScriptRunSummary = {
            ok: result.ok,
            error: error ? error.message : null,
            stack: stackOf(error),
            errorName: error?.name ?? null,
            method: methodOf(error),
            complete: run?.complete ?? false,
            warnings: (run?.warnings ?? []).map((warning) => warning.message).slice(0, 20),
            plots: run ? { ...run.plots } : {},
            vars: scalarVars(run?.vars),
            strategy: run?.kind === 'strategy',
            bars,
            maxBarsBack,
            symbol: cell.symbol,
            timeframe: cell.timeframe,
            logs: [],
          };
          // The debug run is a probe, not an indicator the user asked for.
          result.remove();
          return summary;
        },
        workspace() {
          return wsRef.current;
        },
      }),
      [],
    );

    return (
      <>
        <div ref={hostRef} data-tab-id={tab.id} className="h-full w-full" />
        <CreateAlertDialog draft={alertDraft} onClose={() => setAlertDraft(null)} />
      </>
    );
  },
);
