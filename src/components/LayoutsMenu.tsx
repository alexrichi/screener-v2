import type { ReactNode } from 'react';
import { Menu, Popover } from '@base-ui/react';
import {
  Check,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  Save,
  Upload,
} from 'lucide-react';
import type { LayoutItem } from '../lib/layouts';
import { layoutLabel } from '../lib/format';
import { cn } from '../ui/cn';
import { PopoverContent } from '../ui/overlays';

const menuPopupClass =
  'z-[70] min-w-40 rounded-lg border border-border bg-popover p-1 text-[12px] text-popover-foreground shadow-2xl outline-none';
const menuItemClass =
  'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40';

export interface LayoutActions {
  onOpenTab: (item: LayoutItem) => void;
  onRename: (item: LayoutItem) => void;
  onDuplicate: (item: LayoutItem) => void;
  onExport: (item: LayoutItem) => void;
  onDelete: (item: LayoutItem) => void;
}

export interface LayoutsMenuProps extends LayoutActions {
  open: boolean;
  anchor: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  items: LayoutItem[];
  activeId: string | null;
  onApply: (item: LayoutItem) => void;
  onSaveCurrent: () => void;
  onUpdate: () => void;
  onDuplicateActive: () => void;
  onSaveAs: () => void;
  onShowAll: () => void;
  onImport: () => void;
  onExportAll: () => void;
}

/** The reference-style workspace switcher, anchored to the Vela topbar action. */
export function LayoutsMenu({
  open,
  anchor,
  onOpenChange,
  items,
  activeId,
  onApply,
  onSaveCurrent,
  onUpdate,
  onDuplicateActive,
  onSaveAs,
  onShowAll,
  onImport,
  onExportAll,
  ...actions
}: LayoutsMenuProps) {
  const active = items.find((item) => item.id === activeId) ?? null;
  const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  if (active && !recent.some((item) => item.id === active.id)) recent.unshift(active);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <PopoverContent anchor={anchor} align="end" className="w-72 p-1.5">
        <div className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Recent layouts
        </div>
        <div className="max-h-64 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="px-2 py-2 text-[11px] leading-4 text-muted-foreground">
              No saved layouts yet. Save this workspace to reuse it later.
            </p>
          ) : (
            recent.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-1 rounded-md px-1 hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => onApply(item)}
                  title={`Load ${item.name} into this workspace`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-left text-[12px] text-foreground"
                >
                  <Check
                    className={cn(
                      'size-3.5 shrink-0',
                      item.id === activeId ? 'text-primary' : 'text-transparent',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {layoutLabel(item.layout)}
                  </span>
                </button>
                <LayoutActionsMenu item={item} actions={actions} />
              </div>
            ))
          )}
        </div>
        <div className="my-1 h-px bg-border" />
        {active ? (
          <>
            <MenuButton icon={Save} onClick={onUpdate} title={`Update ${active.name}`}>
              Update “{active.name}”
            </MenuButton>
            <MenuButton
              icon={Copy}
              onClick={onDuplicateActive}
              title={`Duplicate ${active.name}`}
            >
              Duplicate “{active.name}”…
            </MenuButton>
            <MenuButton icon={FilePlus2} onClick={onSaveAs}>
              Save as…
            </MenuButton>
          </>
        ) : (
          <MenuButton icon={Save} onClick={onSaveCurrent}>
            Save current layout…
          </MenuButton>
        )}
        <MenuButton icon={FolderOpen} onClick={onShowAll}>
          Show all layouts…
        </MenuButton>
        <MenuButton icon={Upload} onClick={onImport}>
          Import layout…
        </MenuButton>
        <MenuButton icon={Download} onClick={onExportAll} disabled={items.length === 0}>
          Export all…
        </MenuButton>
      </PopoverContent>
    </Popover.Root>
  );
}

function MenuButton({
  icon: Icon,
  children,
  onClick,
  title,
  disabled,
}: {
  icon: typeof Save;
  children: ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-accent disabled:opacity-40"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** The per-row `⋯` menu: same actions in the popover and the full dialog. */
export function LayoutActionsMenu({
  item,
  actions,
}: {
  item: LayoutItem;
  actions: LayoutActions;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Actions for ${item.name}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground data-[popup-open]:bg-background/60"
      >
        <MoreHorizontal className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="right" align="start" sideOffset={4} className="z-[70] outline-none">
          <Menu.Popup className={menuPopupClass}>
            <Menu.Item className={menuItemClass} onClick={() => actions.onOpenTab(item)}>
              Open in new tab
            </Menu.Item>
            <Menu.Item className={menuItemClass} onClick={() => actions.onRename(item)}>
              Rename
            </Menu.Item>
            <Menu.Item className={menuItemClass} onClick={() => actions.onDuplicate(item)}>
              Duplicate
            </Menu.Item>
            <Menu.Item className={menuItemClass} onClick={() => actions.onExport(item)}>
              Export
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item className={menuItemClass} onClick={() => actions.onDelete(item)}>
              Delete
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
