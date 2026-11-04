import { Download, ExternalLink, Upload } from 'lucide-react';
import type { LayoutItem } from '../lib/layouts';
import { symbolLabel } from '../lib/binance';
import { layoutLabel } from '../lib/format';
import { Button, IconButton } from '../ui/primitives';
import { Modal } from '../ui/overlays';
import { LayoutActionsMenu, type LayoutActions } from './LayoutsMenu';

export interface LayoutsDialogProps extends LayoutActions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: LayoutItem[];
  activeId: string | null;
  onApply: (item: LayoutItem) => void;
  onImport: () => void;
  onExportAll: () => void;
}

/** Full layout manager behind the menu's "Show all layouts…". */
export function LayoutsDialog({
  open,
  onOpenChange,
  items,
  activeId,
  onApply,
  onImport,
  onExportAll,
  ...actions
}: LayoutsDialogProps) {
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Layouts"
      description={`${items.length} saved`}
      className="w-[min(92vw,720px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onImport}>
            <Upload className="size-3" />
            Import
          </Button>
          <Button variant="secondary" onClick={onExportAll} disabled={items.length === 0}>
            <Download className="size-3" />
            Export all
          </Button>
        </>
      }
    >
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">
          No saved layouts. Save the current workspace from the toolbar Layouts menu.
        </p>
      ) : (
        <div className="grid gap-1">
          {sorted.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => onApply(item)}
                title={`Load ${item.name} into this workspace`}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12px] font-medium text-foreground">
                    {item.name}
                  </span>
                  {item.id === activeId ? (
                    <span className="rounded border border-primary/30 bg-primary-soft px-1 text-[9px] font-medium text-primary">
                      current
                    </span>
                  ) : null}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {symbolLabel(item.symbol)} · {item.timeframe} · {layoutLabel(item.layout)} ·{' '}
                  {new Date(item.updatedAt).toLocaleDateString()}
                </div>
              </button>
              <Button size="sm" variant="secondary" onClick={() => onApply(item)}>
                Open
              </Button>
              <IconButton label="Open in new tab" onClick={() => actions.onOpenTab(item)}>
                <ExternalLink className="size-3.5" />
              </IconButton>
              <LayoutActionsMenu item={item} actions={actions} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
