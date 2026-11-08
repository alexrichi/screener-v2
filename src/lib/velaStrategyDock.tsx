import { createRoot } from 'react-dom/client';
import { registerWidgetAttachment } from '@luxalgo/vela/plugin';
import { StrategyPanel } from '../components/StrategyPanel';

/**
 * The strategy summary is a Vela docked strip, not an app flex sibling: the shell
 * keeps the drawing toolbar and the right rail full height and shrinks only the
 * chart column. A flex row under the whole workspace would run beneath those
 * toolbars.
 */
registerWidgetAttachment({
  id: 'screener-strategy-dock',
  mount(ctx) {
    const tabId = ctx.host.closest('[data-tab-id]')?.getAttribute('data-tab-id') ?? '';
    const el = document.createElement('div');
    el.className = 'screener-strategy-dock';
    const root = createRoot(el);
    root.render(<StrategyPanel tabId={tabId} />);
    const strip = ctx.dockStrip(el, { position: 'below-bottombar' });
    return () => {
      root.unmount();
      strip();
    };
  },
});
