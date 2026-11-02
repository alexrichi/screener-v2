import { registerWidgetAction } from '@luxalgo/vela/plugin';

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

// Both live in the topbar's `actions` slot, before Alerts. `refreshActions()` after
// a state change swaps which one renders.
registerWidgetAction({
  id: 'screener-maximize',
  target: 'topbar',
  label: 'Maximize chart',
  icon: 'maximize',
  iconOnly: true,
  align: 'right',
  order: 0,
  mobile: 'bar',
  when: () => state.multi && !state.maximized,
  run: () => toggle?.(),
});

registerWidgetAction({
  id: 'screener-restore',
  target: 'topbar',
  label: 'Restore layout',
  icon: 'restore',
  iconOnly: true,
  align: 'right',
  order: 0,
  mobile: 'bar',
  when: () => state.multi && state.maximized,
  run: () => toggle?.(),
});
