import { useState, type PropsWithChildren } from 'react';
import { ChevronDownIcon, LoaderIcon } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { CollapsibleTrigger } from './assistant-ui/elements/collapsible-root';
import type { ThreadGroupPart } from './assistant-ui/elements/thread.aui';
import {
  ToolGroupContent,
  ToolGroupRoot,
} from './assistant-ui/elements/tool-group.aui';
import { cn } from '../lib/utils';

/**
 * Collapsed activity group for one assistant run: "Used 5 get_script,
 * read_lines, run_script". Expanding shows the individual tool cards; the
 * default group would only say "5 tool calls".
 */
export function ToolActivityGroup({
  group,
  children,
}: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const [open, setOpen] = useState(false);
  // A primitive selector: returning a fresh array here would re-render on every
  // store read and loop the thread (React #185).
  const toolNames = useAuiState((state) => {
    const unique = new Set<string>();
    for (const index of group.indices) {
      const part = state.message.parts[index];
      if (part?.type === 'tool-call') unique.add(part.toolName);
    }
    return [...unique].join(', ');
  });

  const count = group.indices.length;
  const summary = toolNames
    ? `Used ${count} ${toolNames}`
    : `${count} tool ${count === 1 ? 'call' : 'calls'}`;
  const active = group.status.type === 'running';

  return (
    <ToolGroupRoot
      variant="ghost"
      open={open || group.counts.requiresAction > 0}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger
        data-slot="tool-group-trigger"
        className={cn(
          'aui-tool-group-trigger group/trigger flex origin-left items-center gap-2 text-sm transition-[color,scale] active:scale-[0.98]',
          'group-data-[variant=ghost]/tool-group-root:text-muted-foreground group-data-[variant=ghost]/tool-group-root:hover:text-foreground group-data-[variant=ghost]/tool-group-root:py-1.5',
        )}
      >
        {active ? (
          <LoaderIcon className="size-3 shrink-0 animate-spin [animation-duration:0.6s]" />
        ) : null}
        <span
          className={cn(
            'inline-block text-start text-xs leading-none font-normal',
            active && 'shimmer motion-reduce:animate-none',
          )}
        >
          {summary}
        </span>
        <ChevronDownIcon
          className={cn(
            'size-3 shrink-0 -rotate-90 transition-transform duration-200',
            'group-data-open/trigger:rotate-0 group-data-panel-open/trigger:rotate-0',
          )}
        />
      </CollapsibleTrigger>
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}
