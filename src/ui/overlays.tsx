import type { ReactNode } from 'react';
import { Dialog, Popover } from '@base-ui/react';
import { X } from 'lucide-react';
import { cn } from './cn';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
        <Dialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2',
            'overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl outline-none',
            className,
          )}
        >
          <div className="flex h-10 items-center justify-between border-b border-border px-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[13px] font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="truncate text-[11px] text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="max-h-[min(70vh,620px)] overflow-y-auto p-4">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-4 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PopoverContent({
  children,
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  anchor,
}: {
  children: ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Position against an element outside this tree, e.g. a Vela topbar button. */
  anchor?: Element | null;
}) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        anchor={anchor}
        className="z-50 outline-none"
      >
        <Popover.Popup
          className={cn(
            'min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none',
            className,
          )}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
