import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IndicatorHandle } from '@luxalgo/vela';
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace';
import {
  applyIndicatorPayload,
  isIndicatorPayload,
  templateKeyFor,
  templateValuesOf,
} from '../lib/indicatorTemplates';
import {
  migrateLegacyIndicatorTemplates,
  settingsTemplates,
} from '../lib/settingsTemplates';
import {
  SettingsTemplateMenu,
  type SettingsTemplateAdapter,
} from './SettingsTemplateMenu';

interface Props {
  workspace: () => VelaWorkspace | null;
}

interface ChartActions {
  slot: HTMLDivElement;
  initial: ChartTemplatePayload;
  cell: ChartCell;
  renderer: ChartRenderer;
  close: HTMLButtonElement | null;
}

interface Target {
  dialog: Element;
  slot: HTMLDivElement;
  adapter: SettingsTemplateAdapter;
  marker: string;
  actions?: ChartActions;
}

function buttonByText(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll('button')].find(
      (button) => (button.textContent ?? '').trim() === label,
    ) ?? null
  );
}

function cellOf(dialog: Element): string | null {
  let node: Element | null = dialog;
  for (let depth = 0; depth < 10 && node; depth += 1) {
    const id = node.getAttribute('data-cell-id');
    if (id) return id;
    node = node.parentElement;
  }
  return null;
}

function handleOf(
  dialog: Element,
  workspace: VelaWorkspace,
  lastCell: string | null,
): IndicatorHandle | null {
  const probe = dialog.querySelector<HTMLElement>('[id^="vela-inp-"]');
  const inputId = probe?.id ?? '';
  const cells = workspace.cells();
  const cellId = cellOf(dialog) ?? lastCell;
  const preferred = cellId ? cells.find((cell) => cell.id === cellId) : undefined;
  const ordered: ChartCell[] = preferred
    ? [preferred, ...cells.filter((cell) => cell !== preferred)]
    : cells;

  if (inputId) {
    for (const cell of ordered) {
      for (const handle of cell.chart.indicators()) {
        if (inputId.startsWith(`vela-inp-${handle.id}-`)) return handle;
      }
    }
  }

  const title = (dialog.querySelector('.vela-dialog-title')?.textContent ?? '').trim();
  if (title) {
    for (const cell of ordered) {
      for (const handle of cell.chart.indicators()) {
        if (handle.title && title.includes(handle.title)) return handle;
      }
    }
  }
  return null;
}

function indicatorAdapter(
  dialog: Element,
  workspace: VelaWorkspace,
  lastCell: string | null,
): SettingsTemplateAdapter | null {
  const handle = handleOf(dialog, workspace, lastCell);
  if (!handle) return null;
  const reset = buttonByText(dialog, 'Reset defaults');
  const ok = buttonByText(dialog, 'OK');
  const close = dialog.querySelector<HTMLButtonElement>('button.vela-dialog-close');
  return {
    store: settingsTemplates,
    scope: `indicator:${templateKeyFor(handle)}`,
    capture: () => templateValuesOf(handle),
    apply: (payload) => {
      if (!isIndicatorPayload(payload)) throw new Error('Invalid indicator template');
      applyIndicatorPayload(handle, payload);
    },
    reset: () => reset?.click(),
    ...(ok ? { commit: () => ok.click() } : {}),
    ...(close ? { close: () => close.click() } : {}),
  };
}

interface ChartTemplatePayload {
  config: unknown;
  priceStyle?: string;
}

type ChartRenderer = ChartCell['chart']['renderer'];

function isChartPayload(value: unknown): value is ChartTemplatePayload {
  return typeof value === 'object' && value !== null && 'config' in value;
}

function chartState(cell: ChartCell, renderer: ChartRenderer): ChartTemplatePayload {
  return { config: renderer.getConfig(), priceStyle: cell.priceStyle };
}

function applyChartState(
  cell: ChartCell,
  renderer: ChartRenderer,
  payload: ChartTemplatePayload,
): void {
  renderer.applyConfig(payload.config);
  if (typeof payload.priceStyle === 'string') cell.setPriceStyle(payload.priceStyle);
}

interface ChartBinding {
  adapter: SettingsTemplateAdapter;
  initial: ChartTemplatePayload;
  cell: ChartCell;
  renderer: ChartRenderer;
  close: HTMLButtonElement | null;
}

function chartBinding(dialog: Element, workspace: VelaWorkspace): ChartBinding | null {
  const cell = workspace.active;
  const renderer = cell?.chart.renderer;
  if (!cell || !renderer) return null;
  const reset = buttonByText(dialog, 'Reset defaults');
  const close = dialog.querySelector<HTMLButtonElement>('button.vela-dialog-close');
  const initial = chartState(cell, renderer);
  return {
    cell,
    renderer,
    close,
    initial,
    adapter: {
      store: settingsTemplates,
      scope: 'chart',
      // The chart type lives on the cell (priceStyle) as well as in the renderer
      // config; capture both so a template survives a reload.
      capture: () => chartState(cell, renderer),
      apply: (payload) => {
        if (typeof payload !== 'object' || payload === null) {
          throw new Error('Invalid chart template');
        }
        if (isChartPayload(payload)) {
          applyChartState(cell, renderer, payload);
          return;
        }
        // Templates saved before the priceStyle field stored the raw config.
        renderer.applyConfig(payload);
      },
      reset: () => reset?.click(),
      ...(close ? { close: () => close.click() } : {}),
    },
  };
}

function ChartSettingsActions({ actions }: { actions: ChartActions }) {
  const cancel = () => {
    actions.close?.click();
    window.setTimeout(() => {
      try {
        applyChartState(actions.cell, actions.renderer, actions.initial);
      } catch (cause) {
        console.warn('[screener] could not revert chart settings', cause);
      }
    }, 0);
  };
  return (
    <>
      <button type="button" className="vela-dialog-btn" onClick={cancel}>
        Cancel
      </button>
      <button
        type="button"
        className="vela-dialog-btn vela-dialog-btn-primary"
        onClick={() => actions.close?.click()}
      >
        OK
      </button>
    </>
  );
}

/**
 * Vela owns the settings dialogs; this host injects the app's template menu into
 * their footers (the Vela Pro pattern). Indicator dialogs commit on OK and keep a
 * working copy; the chart settings dialog applies live, so it gets Cancel/OK
 * buttons of its own, where Cancel restores the open-time chart state.
 */
export function SettingsTemplateHost({ workspace }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const lastCell = useRef<string | null>(null);

  useEffect(() => {
    try {
      migrateLegacyIndicatorTemplates();
    } catch {
      /* a broken legacy payload must not block the dialogs */
    }
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest('button[data-vela-ctl="settings"]');
      if (!button) return;
      const cell = button.closest('[data-cell-id]');
      lastCell.current = cell?.getAttribute('data-cell-id') ?? null;
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    let frame = 0;

    const scan = () => {
      frame = 0;
      const indicatorDialog = document.querySelector('.vela-ind-dialog');
      const chartDialog = indicatorDialog ? null : document.querySelector('.vela-dialog--settings');
      const dialog = indicatorDialog ?? chartDialog;
      if (!dialog || !dialog.isConnected) {
        setTarget((previous) => (previous ? null : previous));
        return;
      }
      const vela = workspace();
      if (!vela) return;

      const indicator = indicatorDialog ? indicatorAdapter(dialog, vela, lastCell.current) : null;
      const chart = indicatorDialog ? null : chartBinding(dialog, vela);
      const adapter = indicator ?? chart?.adapter;
      if (!adapter) {
        setTarget((previous) => (previous ? null : previous));
        return;
      }

      const marker = adapter.scope;
      const existing = dialog.querySelector<HTMLElement>('[data-screener-templates]');
      if (existing && dialog.getAttribute('data-screener-template-marker') === marker) return;
      existing?.remove();
      dialog.querySelector('[data-screener-actions]')?.remove();

      const reset = buttonByText(dialog, 'Reset defaults');
      const ok = buttonByText(dialog, 'OK');
      const cancel = buttonByText(dialog, 'Cancel');
      const footer = ok?.parentElement ?? reset?.parentElement;
      if (!footer) {
        setTarget((previous) => (previous ? null : previous));
        return;
      }

      const slot = document.createElement('div');
      slot.setAttribute('data-screener-templates', '');
      slot.style.cssText = 'display:flex;align-items:center;margin-right:auto;';
      if (cancel) footer.insertBefore(slot, cancel);
      else footer.appendChild(slot);
      if (reset) reset.style.display = 'none';

      let actions: ChartActions | undefined;
      if (chart) {
        // The chart settings footer has no border of its own; the injected
        // template/actions row needs the same separation as the indicator dialog.
        footer.style.borderTop = '1px solid var(--vela-border)';
        const actionsSlot = document.createElement('div');
        actionsSlot.setAttribute('data-screener-actions', '');
        actionsSlot.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto;';
        footer.appendChild(actionsSlot);
        actions = {
          slot: actionsSlot,
          initial: chart.initial,
          cell: chart.cell,
          renderer: chart.renderer,
          close: chart.close,
        };
      }

      dialog.setAttribute('data-screener-template-marker', marker);
      setTarget({ dialog, slot, adapter, marker, ...(actions ? { actions } : {}) });
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(scan);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [workspace]);

  if (!target) return null;
  return (
    <>
      {createPortal(
        <SettingsTemplateMenu key={target.marker} adapter={target.adapter} />,
        target.slot,
      )}
      {target.actions
        ? createPortal(<ChartSettingsActions actions={target.actions} />, target.actions.slot)
        : null}
    </>
  );
}
