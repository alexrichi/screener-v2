import type { ComponentProps } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;
export const DialogTitle = BaseDialog.Title;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
      <BaseDialog.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(92vw,900px)] -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-border bg-card p-2 text-card-foreground shadow-2xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <BaseDialog.Close
          aria-label="Close"
          className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-4" />
        </BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
