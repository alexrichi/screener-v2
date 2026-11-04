import { registerIcon, registerWidgetAction } from '@luxalgo/vela/plugin';

/** Fallback button text; a linked layout swaps in its name. */
const DEFAULT_LABEL = 'Layouts';
const MAX_LABEL = 24;

let openMenu: ((anchor: HTMLElement | null) => void) | null = null;
let currentLabel = DEFAULT_LABEL;

registerIcon(
  'screener-layouts',
  '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.8" width="12" height="8.4" rx="1.2"/><path d="M6 13.8h4M8 11.2v2.6"/><path d="M4.6 6.2h2.2M4.6 8.2h4.8"/></svg>',
);

function displayLabel(): string {
  const trimmed = currentLabel.trim() || DEFAULT_LABEL;
  return trimmed.length > MAX_LABEL ? `${trimmed.slice(0, MAX_LABEL - 1)}…` : trimmed;
}

function registerAction(): void {
  registerWidgetAction({
    id: 'screener-layouts',
    target: 'topbar',
    label: displayLabel(),
    icon: 'screener-layouts',
    align: 'right',
    // After the maximize actions (order -200) in the right-hand group.
    order: -100,
    mobile: 'menu',
    run: (ctx) => {
      // The action has no event payload, so the clicked button is the focused
      // topbar control; the label identifies it when focus did not land.
      const label = displayLabel();
      const button = [...ctx.host.querySelectorAll('button')].find(
        (candidate) =>
          candidate.getAttribute('aria-label') === label ||
          (candidate.textContent ?? '').trim() === label,
      );
      const anchor =
        button ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      openMenu?.(anchor);
    },
  });
}

/** App owns the popover; the topbar action only asks for it. */
export function setLayoutsBridge(open: ((anchor: HTMLElement | null) => void) | null): void {
  openMenu = open;
}

/**
 * Keep the topbar button on the active tab's layout name. Re-registering
 * replaces the descriptor; the active workspace refreshes its actions after.
 */
export function setLayoutsActionLabel(name: string | null): void {
  const next = (name ?? '').trim() || DEFAULT_LABEL;
  if (next === currentLabel) return;
  currentLabel = next;
  registerAction();
}

registerAction();
