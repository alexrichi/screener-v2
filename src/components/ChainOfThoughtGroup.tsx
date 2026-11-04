import { useState, type PropsWithChildren } from 'react';
import { ChevronDownIcon, LoaderIcon } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from './assistant-ui/elements/collapsible-root';
import type { ThreadGroupPart } from './assistant-ui/elements/thread.aui';
import { cn } from '../lib/utils';

/**
 * The whole run's activity folded into one line ("Used 3 get_script,
 * read_lines, run_script"). Expanding reveals the per-step Thought and tool
 * groups, which stay individually collapsible.
 */
export function ChainOfThoughtGroup({
  group,
  children,
}: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const [open, setOpen] = useState(false);
  const toolCount = useAuiState((state) => {
    let count = 0;
    for (const index of group.indices) {
      if (state.message.parts[index]?.type === 'tool-call') count += 1;
    }
    return count;
  });
  const toolNames = useAuiState((state) => {
    const unique = new Set<string>();
    for (const index of group.indices) {
      const part = state.message.parts[index];
      if (part?.type === 'tool-call') unique.add(part.toolName);
    }
    return [...unique].join(', ');
  });
  const active = group.status.type === 'running';
  const summary = toolCount > 0 ? `Used ${toolCount} ${toolNames}` : 'Activity';

  return (
    <CollapsibleRoot
      open={open || group.counts.requiresAction > 0}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger
        data-slot="chain-of-thought-trigger"
        className={cn(
          'flex origin-left items-center gap-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground active:scale-[0.98]',
        )}
      >
        {active ? (
          <LoaderIcon className="size-3 shrink-0 animate-spin [animation-duration:0.6s]" />
        ) : null}
        <span className={cn('leading-none font-medium', active && 'shimmer motion-reduce:animate-none')}>
          {summary}
        </span>
        <ChevronDownIcon
          className={cn(
            'size-3 shrink-0 -rotate-90 transition-transform duration-200',
            'group-data-open/trigger:rotate-0 group-data-panel-open/trigger:rotate-0',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-l border-border/60 pl-3">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}
