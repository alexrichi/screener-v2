import { Popover } from '@base-ui/react';
import { Code2, Layers, LineChart } from 'lucide-react';
import type { PickerEntry } from '../lib/indicatorPicker';
import { PopoverContent } from '../ui/overlays';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: HTMLElement | null;
  entries: PickerEntry[];
  onAdd: (entry: PickerEntry) => void;
}

function EntryIcon({ entry }: { entry: PickerEntry }) {
  const Icon = entry.kind === 'native' ? LineChart : entry.kind === 'library' ? Layers : Code2;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-muted-foreground">
      <Icon className="size-3" />
    </span>
  );
}

/** Favorite indicators, anchored to the caret on the Indicators control. */
export function FavoritesMenu({ open, onOpenChange, anchor, entries, onAdd }: Props) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <PopoverContent anchor={anchor} side="bottom" align="start" className="w-64 p-1">
        <div className="px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Favorite indicators
        </div>
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-4 text-muted-foreground">
            No favorite indicators yet. Star indicators in the picker.
          </p>
        ) : (
          <div className="grid gap-0.5">
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => onAdd(entry)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-accent"
              >
                <EntryIcon entry={entry} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {entry.family}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover.Root>
  );
}
