import { registerWidgetAction } from '@luxalgo/vela/plugin';

let openWindow: (() => void) | null = null;

/** The app owns the dialog; the topbar action only opens it. */
export function setIndicatorWindowBridge(open: (() => void) | null): void {
  openWindow = open;
}

// Registering under the built-in `indicators` id replaces the native picker.
// Vela still wires the topbar button, the `/` shortcut and the mobile stop to
// this run, but never constructs its own dialog.
registerWidgetAction({
  id: 'indicators',
  target: 'topbar',
  label: 'Indicators',
  icon: 'indicators',
  run: () => openWindow?.(),
});
