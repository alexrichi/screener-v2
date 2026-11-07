import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  registerIcon,
  registerSidePanel,
  registerWidgetAttachment,
  type WidgetContext,
} from '@luxalgo/vela/plugin';
import { alertsFor, subscribeAlerts } from './alerts';

export type VelaPanelId = 'screener' | 'pine' | 'library' | 'alerts';

interface PanelMount {
  tabId: string;
  body: HTMLElement;
  toggle: (id: string, open?: boolean) => void;
}

const mounts = new Map<string, PanelMount>();
const listeners = new Set<() => void>();
let version = 0;
let activeTabId: string | null = null;
let mountingTabId: string | null = null;
let pendingOpen: { id: VelaPanelId; tabId: string } | null = null;

function mountKey(tabId: string, id: VelaPanelId): string {
  return `${tabId}:${id}`;
}

function panelTabId(ctx: WidgetContext): string {
  return (
    mountingTabId ??
    ctx.host.closest('[data-tab-id]')?.getAttribute('data-tab-id') ??
    ''
  );
}

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): number {
  return version;
}

/** Tell the panel layer which workspace tab is on screen. */
export function setActiveVelaTab(tabId: string): void {
  activeTabId = tabId || null;
}

/** Mark the tab whose Vela workspace is being constructed (its panel mounts run then). */
export function setMountingVelaTab(tabId: string | null): void {
  mountingTabId = tabId;
}

/** Open one of the workspace panels on the active tab. No-op until it mounts. */
export function openVelaPanel(id: VelaPanelId): void {
  const tabId = activeTabId;
  if (!tabId) return;
  const mount = mounts.get(mountKey(tabId, id));
  if (mount) mount.toggle(id, true);
  else pendingOpen = { id, tabId };
}

function mountPanel(
  id: VelaPanelId,
  ctx: WidgetContext,
  body: HTMLElement,
): () => void {
  const tabId = panelTabId(ctx);
  const key = mountKey(tabId, id);
  const toggle = (panelId: string, open?: boolean) => ctx.togglePanel(panelId, open);
  const mount: PanelMount = { tabId, body, toggle };
  mounts.set(key, mount);
  // The dock body starts with the kit's panel padding; the app panels own their
  // internal scrolling and expect the full body height.
  body.style.padding = '0';
  body.style.overflow = 'hidden';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.minHeight = '0';
  body.classList.add('screener-panel-body');
  emit();

  if (pendingOpen?.id === id && pendingOpen.tabId === tabId) {
    pendingOpen = null;
    queueMicrotask(() => {
      if (mounts.get(key) === mount) toggle(id, true);
    });
  }

  return () => {
    if (mounts.get(key) === mount) mounts.delete(key);
    emit();
  };
}

registerIcon(
  'screener-panel',
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-width="1" vector-effect="non-scaling-stroke"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',
);
registerIcon(
  'pine-panel',
  '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
);
registerIcon(
  'library-panel',
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>',
);
registerSidePanel({
  id: 'screener',
  title: 'Screener',
  icon: 'screener-panel',
  order: 40,
  width: 420,
  resizable: true,
  minWidth: 320,
  maxWidth: 760,
  maximizable: true,
  mount: (ctx, body) => {
    const destroy = mountPanel('screener', ctx, body);
    const tabId = panelTabId(ctx);
    // First run after the dock migration: keep the table visible by default.
    try {
      if (!localStorage.getItem('screener.panels.welcomed')) {
        localStorage.setItem('screener.panels.welcomed', '1');
        queueMicrotask(() => {
          if (mounts.get(mountKey(tabId, 'screener'))?.body === body) {
            ctx.togglePanel('screener', true);
          }
        });
      }
    } catch {
      /* storage unavailable — still show the panel this session */
    }
    return { destroy };
  },
});

registerSidePanel({
  id: 'pine',
  title: 'Pine',
  icon: 'pine-panel',
  order: 50,
  width: 460,
  resizable: true,
  minWidth: 340,
  maxWidth: 900,
  maximizable: true,
  mount: (ctx, body) => ({ destroy: mountPanel('pine', ctx, body) }),
});

registerSidePanel({
  id: 'library',
  title: 'Library',
  icon: 'library-panel',
  order: 60,
  width: 380,
  resizable: true,
  minWidth: 300,
  maxWidth: 620,
  maximizable: true,
  mount: (ctx, body) => ({ destroy: mountPanel('library', ctx, body) }),
});

registerSidePanel({
  id: 'alerts',
  title: 'Alerts',
  icon: 'bell',
  order: 70,
  width: 320,
  resizable: true,
  minWidth: 260,
  maxWidth: 560,
  maximizable: true,
  mount: (ctx, body) => {
    const destroy = mountPanel('alerts', ctx, body);
    const tabId = panelTabId(ctx);
    const sync = () => ctx.sidebar.setBadge('alerts', alertsFor(tabId).length);
    const off = subscribeAlerts(sync);
    sync();
    return {
      destroy: () => {
        off();
        destroy();
      },
    };
  },
});

// The rail's alerts panel replaces Vela's topbar bell; its menu only lists the
// workspace's own entries and has no panel of its own.
registerWidgetAttachment({
  id: 'screener-alerts-panel',
  mount: (ctx) => {
    ctx.topbar.setVisible('alerts', false);
    return () => ctx.topbar.setVisible('alerts', true);
  },
});

interface Props {
  /** Workspace tab whose panel bodies receive the app content. */
  tabId: string;
  panels: Partial<Record<VelaPanelId, ReactNode>>;
}

/** Renders the app panels into the active workspace's Vela side-panel bodies. */
export function VelaPanelPortals({ tabId, panels }: Props) {
  useSyncExternalStore(subscribe, snapshot, () => 0);
  return (
    <>
      {(Object.entries(panels) as Array<[VelaPanelId, ReactNode]>).map(([id, node]) => {
        const mount = tabId ? mounts.get(mountKey(tabId, id)) : undefined;
        return mount ? createPortal(node, mount.body, id) : null;
      })}
    </>
  );
}
