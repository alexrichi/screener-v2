import type { ComponentProps } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react';
import { cn } from '@/lib/utils';

export const TooltipProvider = BaseTooltip.Provider;
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

export function TooltipContent({
  className,
  children,
  side = 'top',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof BaseTooltip.Popup> & {
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={cn(
            'z-50 w-fit rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow-md outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}
