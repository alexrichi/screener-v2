import { registerIcon, registerWidgetAction } from '@luxalgo/vela/plugin';

/** 16×16 chrome icon, matching Vela's own chrome tier. */
function icon(body: string): string {
  return `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// Vela's pane controls already use `maximize` / `restore` (four corner brackets).
// These are diagonal arrows so the workspace action reads differently.
registerIcon(
  'screener-expand',
  icon(
    '<path d="M7 7 3.2 3.2M3.2 3.2h3.3M3.2 3.2v3.3M9 7l3.8-3.8M12.8 3.2h-3.3M12.8 3.2v3.3M7 9l-3.8 3.8M3.2 12.8h3.3M3.2 12.8v-3.3M9 9l3.8 3.8M12.8 12.8h-3.3M12.8 12.8v-3.3"/>',
  ),
);
registerIcon(
  'screener-collapse',
  icon(
    '<path d="M3.2 3.2 6.8 6.8M6.8 6.8H3.5M6.8 6.8V3.5M12.8 3.2 9.2 6.8M9.2 6.8h3.3M9.2 6.8V3.5M3.2 12.8 6.8 9.2M6.8 9.2H3.5M6.8 9.2v3.3M12.8 12.8 9.2 9.2M9.2 9.2h3.3M9.2 9.2v3.3"/>',
  ),
);


interface MaximizeState {
  maximized: boolean;
  multi: boolean;
}

const state: MaximizeState = { maximized: false, multi: false };
let toggle: (() => void) | null = null;

/** Feed the workspace's live maximize state to the topbar widget actions. */
export function setMaximizeBridge(next: {
  maximized: boolean;
  multi: boolean;
  toggle: () => void;
}): void {
  state.maximized = next.maximized;
  state.multi = next.multi;
  toggle = next.toggle;
}

export function clearMaximizeBridge(): void {
  state.maximized = false;
  state.multi = false;
  toggle = null;
}

// Both live in the topbar's `actions` slot: leftmost in the right cluster, before
// Layouts and Alerts. `refreshActions()` after a state change swaps which one
// renders.
registerWidgetAction({
  id: 'screener-maximize',
  target: 'topbar',
  label: 'Maximize chart',
  icon: 'screener-expand',
  iconOnly: true,
  align: 'right',
  order: -200,
  mobile: 'bar',
  when: () => state.multi && !state.maximized,
  run: () => toggle?.(),
});

registerWidgetAction({
  id: 'screener-restore',
  target: 'topbar',
  label: 'Restore layout',
  icon: 'screener-collapse',
  iconOnly: true,
  align: 'right',
  order: -200,
  mobile: 'bar',
  when: () => state.multi && state.maximized,
  run: () => toggle?.(),
});
