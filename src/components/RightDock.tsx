import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Tabs } from '@base-ui/react';
import {
  Code2,
  Library,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Table2,
} from 'lucide-react';
import type { DockTab } from '../types';
import { cn } from '../ui/cn';
import { IconButton } from '../ui/primitives';

interface Props {
  open: boolean;
  expanded: boolean;
  width: number;
  tab: DockTab;
  screener: ReactNode;
  pine: ReactNode;
  library: ReactNode;
  onTabChange: (tab: DockTab) => void;
  onToggle: () => void;
  onToggleExpanded: () => void;
  onWidthChange: (width: number) => void;
}

export function RightDock({
  open,
  expanded,
  width,
  tab,
  screener,
  pine,
  library,
  onTabChange,
  onToggle,
  onToggleExpanded,
  onWidthChange,
}: Props) {
  const asideRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  if (!open) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-2">
        <IconButton label="Open panel" onClick={onToggle}>
          <PanelRightOpen className="size-3.5" />
        </IconButton>
        <div className="my-1 h-px w-5 bg-border" />
        <IconButton
          label="Screener"
          onClick={() => {
            onTabChange('screener');
            onToggle();
          }}
        >
          <Table2 className="size-3.5" />
        </IconButton>
        <IconButton
          label="Pine"
          onClick={() => {
            onTabChange('pine');
            onToggle();
          }}
        >
          <Code2 className="size-3.5" />
        </IconButton>
        <IconButton
          label="Library"
          onClick={() => {
            onTabChange('library');
            onToggle();
          }}
        >
          <Library className="size-3.5" />
        </IconButton>
      </aside>
    );
  }

  const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width, width };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };

  const onSplitterMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const max = Math.max(320, Math.min(640, window.innerWidth * 0.55));
    const next = Math.min(max, Math.max(300, drag.startWidth - (event.clientX - drag.startX)));
    drag.width = next;
    if (asideRef.current) asideRef.current.style.width = `${next}px`;
  };

  const onSplitterUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    onWidthChange(drag.width);
  };

  return (
    <div className={expanded ? 'contents' : 'flex h-full min-h-0 shrink-0'}>
      {!expanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize; double-click to reset"
          onPointerDown={onSplitterDown}
          onPointerMove={onSplitterMove}
          onPointerUp={onSplitterUp}
          onDoubleClick={() => onWidthChange(420)}
          className="w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-primary/40"
        />
      ) : null}
      <aside
        ref={asideRef}
        style={expanded ? undefined : { width }}
        className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card',
          expanded
            ? 'fixed inset-x-0 bottom-0 top-9 z-40 border-t border-border'
            : 'border-l border-border',
        )}
      >
        <Tabs.Root
          value={tab}
          onValueChange={(value) => onTabChange(value as DockTab)}
          className="flex h-full min-h-0 flex-col"
        >
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
            <Tabs.List className="flex min-w-0 items-center gap-0.5">
              <Tabs.Tab
                value="screener"
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-[11px] font-medium text-muted-foreground transition-colors',
                  'hover:bg-accent hover:text-foreground',
                  'data-[active]:border-primary/30 data-[active]:bg-primary-soft data-[active]:text-foreground',
                )}
              >
                <Table2 className="size-3.5" />
                Screener
              </Tabs.Tab>
              <Tabs.Tab
                value="pine"
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-[11px] font-medium text-muted-foreground transition-colors',
                  'hover:bg-accent hover:text-foreground',
                  'data-[active]:border-primary/30 data-[active]:bg-primary-soft data-[active]:text-foreground',
                )}
              >
                <Code2 className="size-3.5" />
                Pine
              </Tabs.Tab>
              <Tabs.Tab
                value="library"
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-[11px] font-medium text-muted-foreground transition-colors',
                  'hover:bg-accent hover:text-foreground',
                  'data-[active]:border-primary/30 data-[active]:bg-primary-soft data-[active]:text-foreground',
                )}
              >
                <Library className="size-3.5" />
                Library
              </Tabs.Tab>
            </Tabs.List>
            <div className="ml-auto flex items-center gap-0.5">
              <IconButton
                label={expanded ? 'Restore panel' : 'Expand panel'}
                onClick={onToggleExpanded}
              >
                {expanded ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </IconButton>
              <IconButton label="Collapse panel" onClick={onToggle}>
                <PanelRightClose className="size-3.5" />
              </IconButton>
            </div>
          </div>
          <Tabs.Panel value="screener" className="min-h-0 flex-1 overflow-hidden">
            {screener}
          </Tabs.Panel>
          <Tabs.Panel value="pine" className="min-h-0 flex-1 overflow-hidden">
            {pine}
          </Tabs.Panel>
          <Tabs.Panel value="library" className="min-h-0 flex-1 overflow-hidden">
            {library}
          </Tabs.Panel>
        </Tabs.Root>
      </aside>
    </div>
  );
}
