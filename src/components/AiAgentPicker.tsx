import { useState } from 'react';
import { Popover } from '@base-ui/react';
import { Bot, Check, ChevronDown } from 'lucide-react';
import type { AiAgent, AiAgentId } from '../lib/ai/agents';
import { PopoverContent } from '../ui/overlays';
import { cn } from '../ui/cn';

interface Props {
  agent: AiAgent;
  agents: AiAgent[];
  onAgentChange: (id: AiAgentId) => void;
  model?: string | null;
  compact?: boolean;
}

/** Agent presets for both the app chat header and the assistant-ui composer. */
export function AiAgentPicker({ agent, agents, onAgentChange, model, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title={model ? `Agent: ${agent.label} · model ${model}` : `Agent: ${agent.label}`}
        aria-label={`Agent: ${agent.label}`}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 hover:bg-accent',
          compact
            ? 'h-7 rounded-full border border-border/70 px-2.5 text-[12px] text-muted-foreground'
            : 'rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground/80',
        )}
      >
        <Bot className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{agent.label}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <PopoverContent className="w-72 p-1" align="start">
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Agent
        </div>
        {agents.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              onAgentChange(entry.id);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-start gap-1.5 rounded px-2 py-1.5 text-left hover:bg-accent/60',
              entry.id === agent.id && 'bg-primary-soft/60',
            )}
          >
            <span className="mt-0.5 w-3 shrink-0">
              {entry.id === agent.id ? <Check className="size-3 text-primary" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-foreground/90">{entry.label}</span>
              <span className="block text-[10px] text-muted-foreground">{entry.hint}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover.Root>
  );
}
