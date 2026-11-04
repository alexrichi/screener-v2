import { useEffect, useMemo, useState } from 'react';
import { Popover } from '@base-ui/react';
import { Brain, Check, ChevronDown, Cpu, Search } from 'lucide-react';
import {
  AI_REASONING_LEVELS,
  fetchAiModels,
  type AiReasoning,
} from '../lib/ai/model';
import { PopoverContent } from '../ui/overlays';
import { cn } from '../ui/cn';

interface Props {
  /** A concrete model id, or null to use the sidecar's configured model. */
  model: string | null;
  defaultModel: string | null;
  onModelChange: (model: string | null) => void;
}

const REASONING_LABEL: Record<AiReasoning, string> = {
  auto: 'Auto',
  none: 'None',
  low: 'Low',
  medium: 'Med',
  high: 'High',
};

/** Composer model + reasoning picker, backed by the provider's /models catalog. */
export function AiModelPicker({ model, defaultModel, onModelChange }: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (!open || models.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchAiModels()
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [models.length, open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? models.filter((entry) => entry.toLowerCase().includes(needle)) : models;
  }, [models, query]);

  const label = model || 'Auto';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title={`Model: ${model ?? defaultModel ?? 'configured'}`}
        aria-label={`Model: ${label}`}
        className="inline-flex h-7 max-w-[120px] min-w-0 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-[12px] text-muted-foreground hover:bg-accent"
      >
        <Cpu className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Model
        </div>
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search models"
            placeholder="Search models…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-md border border-input bg-transparent py-1 pl-7 pr-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
        </div>
        <div className="max-h-52 overflow-y-auto">
          <button
            type="button"
            onClick={() => onModelChange(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-accent/60',
              model === null && 'bg-primary-soft/50',
            )}
          >
            <span className="w-3 shrink-0">
              {model === null ? <Check className="size-3 text-primary" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-foreground/90">Auto</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {defaultModel ? `Configured: ${defaultModel}` : 'Configured model'}
              </span>
            </span>
          </button>
          {filtered.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onModelChange(entry)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-accent/60',
                model === entry && 'bg-primary-soft/50',
              )}
            >
              <span className="w-3 shrink-0">
                {model === entry ? <Check className="size-3 text-primary" /> : null}
              </span>
              <span className="truncate font-mono text-[11px] text-foreground/90">{entry}</span>
            </button>
          ))}
          {!loading && filtered.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              {error ? `Catalog unavailable: ${error}` : 'No matching models.'}
            </p>
          ) : null}
          {loading ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">Loading models…</p>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2">
          <input
            aria-label="Custom model"
            placeholder="custom model id"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 font-mono text-[11px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring"
          />
          <button
            type="button"
            onClick={() => {
              const next = custom.trim();
              if (next) onModelChange(next);
              setCustom('');
            }}
            disabled={!custom.trim()}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent disabled:opacity-40"
          >
            Use
          </button>
        </div>
      </PopoverContent>
    </Popover.Root>
  );
}

interface ReasoningProps {
  reasoning: AiReasoning;
  onReasoningChange: (reasoning: AiReasoning) => void;
}

const REASONING_HINT: Record<AiReasoning, string> = {
  auto: 'provider default',
  none: 'no thinking',
  low: 'quick',
  medium: 'balanced',
  high: 'deep',
};

/** Separate reasoning control, next to the model picker like OpenCode. */
export function AiReasoningPicker({ reasoning, onReasoningChange }: ReasoningProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title={`Reasoning: ${REASONING_LABEL[reasoning]}`}
        aria-label={`Reasoning: ${REASONING_LABEL[reasoning]}`}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 text-[12px] text-muted-foreground hover:bg-accent"
      >
        <Brain className="size-3 shrink-0" />
        <span>{REASONING_LABEL[reasoning]}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <PopoverContent className="w-48 p-1" align="start">
        {AI_REASONING_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => {
              onReasoningChange(level);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-accent/60',
              reasoning === level && 'bg-primary-soft/50',
            )}
          >
            <span className="w-3 shrink-0">
              {reasoning === level ? <Check className="size-3 text-primary" /> : null}
            </span>
            <span className="text-foreground/90">{REASONING_LABEL[level]}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{REASONING_HINT[level]}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover.Root>
  );
}
